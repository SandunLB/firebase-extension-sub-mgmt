require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

const app = express();
app.use(cors());

// Use express.json() for all routes except /webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

app.post('/create-checkout-session', async (req, res) => {
  const { uniqueUserId, plan } = req.body;

  const prices = {
    monthly: 'price_1Q6WBLEUAhHysq2jITe3wtgX',
    yearly: 'price_1Q6WByEUAhHysq2jjsVWO0ct',
    lifetime: 'price_1Q6WCKEUAhHysq2jx5LrHZFE',
  };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: prices[plan],
          quantity: 1,
        },
      ],
      mode: plan === 'lifetime' ? 'payment' : 'subscription',
      success_url: `${process.env.SERVER_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.EXTENSION_URL}`,
      client_reference_id: uniqueUserId,
      metadata: {
        uniqueUserId,
        plan,
      },
    });

    res.json({ sessionId: session.id, sessionUrl: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    await handleSuccessfulPayment(session);
    res.redirect(`${process.env.EXTENSION_URL}?payment=success`);
  } catch (error) {
    console.error('Error processing successful payment:', error);
    res.redirect(`${process.env.EXTENSION_URL}?payment=error`);
  }
});

app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      await handleSuccessfulPayment(session);
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.created':
    case 'customer.subscription.trial_will_end':
      const subscription = event.data.object;
      await handleSubscriptionUpdate(subscription);
      break;
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      const invoice = event.data.object;
      await handleInvoicePayment(invoice);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

app.get('/check-subscription/:uniqueUserId', async (req, res) => {
  try {
    const status = await checkSubscriptionStatus(req.params.uniqueUserId);
    res.json(status);
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({ error: 'Failed to check subscription status' });
  }
});

app.post('/create-customer-portal-session', async (req, res) => {
  const { uniqueUserId } = req.body;

  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('uniqueUserId', '==', uniqueUserId).get();

    if (snapshot.empty) {
      return res.status(400).json({ error: 'User not found' });
    }

    const userData = snapshot.docs[0].data();

    if (!userData.stripeCustomerId) {
      return res.status(400).json({ error: 'User does not have a Stripe customer ID' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: `${process.env.EXTENSION_URL}`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating customer portal session:', error);
    res.status(500).json({ error: 'Failed to create customer portal session' });
  }
});

async function handleSuccessfulPayment(session) {
  const uniqueUserId = session.client_reference_id;
  if (!uniqueUserId) {
    console.error('No uniqueUserId found in session metadata');
    return;
  }

  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('uniqueUserId', '==', uniqueUserId).get();

  if (snapshot.empty) {
    console.error('No user found with the given unique ID');
    return;
  }

  const userDoc = snapshot.docs[0];
  const userRef = userDoc.ref;

  let customerData = {};
  if (session.customer) {
    try {
      const customer = await stripe.customers.retrieve(session.customer);
      customerData = {
        stripeCustomerId: session.customer,
        stripeEmail: customer.email,
        stripeDefaultPaymentMethod: customer.invoice_settings?.default_payment_method,
      };
      
      // Update customer metadata with uniqueUserId
      await stripe.customers.update(session.customer, {
        metadata: { uniqueUserId: uniqueUserId }
      });
    } catch (error) {
      console.error('Error retrieving or updating customer data:', error);
    }
  }

  if (session.metadata.plan === 'lifetime') {
    await userRef.set({
      ...customerData,
      subscription: {
        status: 'active',
        plan: 'lifetime',
        startDate: admin.firestore.FieldValue.serverTimestamp(),
        endDate: null,
      }
    }, { merge: true });
  } else {
    let subscriptionData = {};
    if (session.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        // Attach uniqueUserId to subscription metadata
        await stripe.subscriptions.update(subscription.id, {
          metadata: { uniqueUserId: uniqueUserId }
        });
        subscriptionData = {
          status: 'active',
          plan: session.metadata.plan,
          startDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
          endDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
          stripeSubscriptionId: subscription.id,
        };
      } catch (error) {
        console.error('Error retrieving or updating subscription data:', error);
        subscriptionData = {
          status: 'active',
          plan: session.metadata.plan,
          startDate: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    }
    await userRef.set({
      ...customerData,
      subscription: subscriptionData,
    }, { merge: true });
  }
}

async function handleSubscriptionUpdate(subscription) {
  let uniqueUserId = subscription.metadata?.uniqueUserId;
  
  if (!uniqueUserId) {
    try {
      const customer = await stripe.customers.retrieve(subscription.customer);
      uniqueUserId = customer.metadata?.uniqueUserId;
      
      if (!uniqueUserId) {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('stripeCustomerId', '==', subscription.customer).get();
        
        if (!snapshot.empty) {
          uniqueUserId = snapshot.docs[0].data().uniqueUserId;
          await stripe.customers.update(subscription.customer, {
            metadata: { uniqueUserId: uniqueUserId }
          });
          await stripe.subscriptions.update(subscription.id, {
            metadata: { uniqueUserId: uniqueUserId }
          });
        } else {
          console.error('No user found with the given Stripe customer ID');
          return;
        }
      }
    } catch (error) {
      console.error('Error retrieving customer data:', error);
      return;
    }
  }

  if (!uniqueUserId) {
    console.error('No uniqueUserId found in subscription or customer metadata');
    return;
  }

  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('uniqueUserId', '==', uniqueUserId).get();

  if (snapshot.empty) {
    console.error('No user found with the given unique ID');
    return;
  }

  const userDoc = snapshot.docs[0];
  const userRef = userDoc.ref;
  const userData = userDoc.data();

  let updateData = {};

  if (subscription.cancel_at_period_end) {
    // User has canceled the plan
    updateData = {
      status: 'active_canceling',
      // Keep the current plan unchanged
      plan: userData.subscription ? userData.subscription.plan : subscription.items.data[0].price.nickname,
      endDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
      canceledAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    };
  } else if (subscription.status === 'active') {
    if (userData.subscription && userData.subscription.status === 'active_canceling') {
      // User has reactivated their subscription
      updateData = {
        status: 'active',
        plan: subscription.items.data[0].price.nickname,
        startDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
        endDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
        canceledAt: null,
      };
    } else {
      // Regular active subscription update
      updateData = {
        status: 'active',
        plan: subscription.items.data[0].price.nickname,
        startDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
        endDate: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
      };
    }
  }

  if (Object.keys(updateData).length > 0) {
    await userRef.set({
      subscription: updateData
    }, { merge: true });
    console.log(`Updated subscription for user ${uniqueUserId}: ${JSON.stringify(updateData)}`);
  }
}

async function handleInvoicePayment(invoice) {
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    await handleSubscriptionUpdate(subscription);
  }
}

async function checkSubscriptionStatus(uniqueUserId) {
  if (!uniqueUserId) {
    console.error('No uniqueUserId provided to checkSubscriptionStatus');
    return { status: 'error', message: 'No user ID provided' };
  }

  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('uniqueUserId', '==', uniqueUserId).get();

  if (snapshot.empty) {
    return { status: 'none', message: 'User not found' };
  }

  const userData = snapshot.docs[0].data();

  if (!userData.subscription) {
    return { status: 'none', message: 'No subscription found' };
  }

  if (userData.subscription.plan === 'lifetime') {
    return { status: 'active', plan: 'lifetime' };
  }

  const now = admin.firestore.Timestamp.now();

  if (userData.subscription.status === 'active_canceling' && now.toMillis() > userData.subscription.endDate.toMillis()) {
    await snapshot.docs[0].ref.set({
      subscription: {
        status: 'expired',
        plan: userData.subscription.plan,
        endDate: userData.subscription.endDate,
      }
    }, { merge: true });
    return { status: 'expired', plan: userData.subscription.plan };
  }

  return {
    status: userData.subscription.status,
    plan: userData.subscription.plan,
    endDate: userData.subscription.endDate
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
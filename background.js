import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

const firebaseConfig = {
  apiKey: "AIzaSyBQ8g_x1Sa9fQM28sKmdljsXxhY3EqGbK0",
  authDomain: "webpack-extension.firebaseapp.com",
  projectId: "webpack-extension",
  storageBucket: "webpack-extension.appspot.com",
  messagingSenderId: "72934072778",
  appId: "1:72934072778:web:796b73448f2b73806e2f33"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const BACKEND_URL = 'http://localhost:3000'; // Update this with your actual backend URL when deployed

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'signIn') {
    signIn();
  } else if (message.action === 'signOut') {
    signOut(auth)
      .then(() => {
        chrome.identity.clearAllCachedAuthTokens(() => {
          console.log('Cleared all cached auth tokens');
        });
        chrome.runtime.sendMessage({ action: 'signOutResult', success: true });
      })
      .catch((error) => {
        console.error('Sign-out error:', error);
        chrome.runtime.sendMessage({ action: 'signOutResult', success: false, error: error.message });
      });
  } else if (message.action === 'getAuthState') {
    sendAuthState();
  } else if (message.action === 'initiateSubscription') {
    initiateSubscription(message.plan);
  } else if (message.action === 'checkSubscription') {
    checkSubscription(message.uid);
  } else if (message.action === 'openCustomerPortal') {
    openCustomerPortal();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('payment=success')) {
    chrome.tabs.remove(tabId);
    if (auth.currentUser) {
      checkSubscription(auth.currentUser.uid);
    } else {
      console.error('User not signed in when payment succeeded');
    }
  }
});

async function signIn() {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });

    const credential = GoogleAuthProvider.credential(null, token);
    const result = await signInWithCredential(auth, credential);
    const user = result.user;

    await storeUserData(user, token);

    chrome.runtime.sendMessage({ 
      action: 'signInResult', 
      success: true, 
      user: {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL
      }
    });
  } catch (error) {
    console.error('Sign-in error:', error);
    chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: error.message });
  }
}

async function storeUserData(user, token) {
  const userRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    // New user, add trial period and generate unique ID
    const trialEnd = new Date();
    trialEnd.setHours(trialEnd.getHours() + 24);
    const uniqueUserId = uuidv4(); // Generate a unique ID

    await setDoc(userRef, {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      createdAt: serverTimestamp(),
      trialEnd: trialEnd,
      subscription: {
        status: 'trial',
        plan: 'trial',
        endDate: trialEnd
      },
      uniqueUserId: uniqueUserId // Store the unique ID
    });
  } else {
    // Existing user, update last login
    await setDoc(userRef, {
      lastLogin: serverTimestamp(),
    }, { merge: true });
  }
}

function sendAuthState() {
  const user = auth.currentUser;
  if (user) {
    chrome.runtime.sendMessage({ 
      action: 'signInResult', 
      success: true, 
      user: {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL
      }
    });
  } else {
    chrome.runtime.sendMessage({ action: 'signOutResult', success: true });
  }
}

async function initiateSubscription(plan, retries = 3) {
  const user = auth.currentUser;
  if (!user) {
    chrome.runtime.sendMessage({ action: 'subscriptionError', error: 'User not signed in' });
    return;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    let userData = userDoc.data();

    if (!userData || !userData.uniqueUserId) {
      if (retries > 0) {
        console.log(`User data or unique ID not found. Retrying in 2 seconds. Retries left: ${retries - 1}`);
        setTimeout(() => initiateSubscription(plan, retries - 1), 2000);
        return;
      }
      throw new Error('User data or unique ID not found after retries');
    }

    const response = await fetch(`${BACKEND_URL}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uniqueUserId: userData.uniqueUserId,
        plan: plan,
      }),
    });

    const data = await response.json();

    if (data.sessionUrl) {
      chrome.tabs.create({ url: data.sessionUrl });
    } else {
      throw new Error('Failed to create checkout session');
    }
  } catch (error) {
    console.error('Subscription initiation error:', error);
    chrome.runtime.sendMessage({ action: 'subscriptionError', error: error.message });
  }
}

async function checkSubscription(uid) {
  try {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();

    if (!userData || !userData.uniqueUserId) {
      throw new Error('User data or unique ID not found');
    }

    const response = await fetch(`${BACKEND_URL}/check-subscription/${userData.uniqueUserId}`);
    const data = await response.json();
    chrome.runtime.sendMessage({ action: 'subscriptionStatus', status: data });
  } catch (error) {
    console.error('Error checking subscription:', error);
    chrome.runtime.sendMessage({ action: 'subscriptionStatus', status: null });
  }
}

async function openCustomerPortal() {
  const user = auth.currentUser;
  if (!user) {
    chrome.runtime.sendMessage({ action: 'error', error: 'User not signed in' });
    return;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();

    if (!userData || !userData.uniqueUserId) {
      throw new Error('User data or unique ID not found');
    }

    const response = await fetch(`${BACKEND_URL}/create-customer-portal-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uniqueUserId: userData.uniqueUserId,
      }),
    });

    const data = await response.json();

    if (data.url) {
      chrome.tabs.create({ url: data.url });
    } else {
      throw new Error('Failed to create customer portal session');
    }
  } catch (error) {
    console.error('Customer portal error:', error);
    chrome.runtime.sendMessage({ action: 'error', error: error.message });
  }
}

// Check subscription status every hour
setInterval(() => {
  if (auth.currentUser) {
    checkSubscription(auth.currentUser.uid);
  }
}, 3600000);

// Also check when the extension is opened
chrome.runtime.onStartup.addListener(() => {
  if (auth.currentUser) {
    checkSubscription(auth.currentUser.uid);
  }
});
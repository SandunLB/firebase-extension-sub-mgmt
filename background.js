import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';

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

const BACKEND_URL = 'http://localhost:3000'; 

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
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url.includes('payment=success')) {
    chrome.tabs.remove(tabId);
    checkSubscription(auth.currentUser.uid);
  }
});

function signIn() {
  chrome.identity.getAuthToken({ interactive: true }, function(token) {
    if (chrome.runtime.lastError) {
      console.error('getAuthToken error:', chrome.runtime.lastError);
      chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: chrome.runtime.lastError.message });
      return;
    }

    const credential = GoogleAuthProvider.credential(null, token);
    signInWithCredential(auth, credential)
      .then((result) => {
        const user = result.user;
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
      })
      .catch((error) => {
        console.error('signInWithCredential error:', error);
        chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: error.message });
      });
  });
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

async function initiateSubscription(plan) {
  const user = auth.currentUser;
  if (!user) {
    chrome.runtime.sendMessage({ action: 'subscriptionError', error: 'User not signed in' });
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: user.uid,
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
    const response = await fetch(`${BACKEND_URL}/check-subscription/${uid}`);
    const data = await response.json();
    chrome.runtime.sendMessage({ action: 'subscriptionStatus', status: data.subscription });
  } catch (error) {
    console.error('Error checking subscription:', error);
    chrome.runtime.sendMessage({ action: 'subscriptionStatus', status: null });
  }
}
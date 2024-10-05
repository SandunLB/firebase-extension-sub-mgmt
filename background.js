import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

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

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'signIn') {
    signIn();
  } else if (message.action === 'signOut') {
    signOut(auth)
      .then(() => {
        chrome.runtime.sendMessage({ action: 'signOutResult', success: true });
      })
      .catch((error) => {
        chrome.runtime.sendMessage({ action: 'signOutResult', success: false, error: error.message });
      });
  } else if (message.action === 'getAuthState') {
    sendAuthState();
  }
});

function signIn() {
  chrome.identity.getAuthToken({ interactive: true }, function(token) {
    if (chrome.runtime.lastError) {
      chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: chrome.runtime.lastError });
      return;
    }

    const credential = GoogleAuthProvider.credential(null, token);
    signInWithCredential(auth, credential)
      .then((result) => {
        const user = result.user;
        storeUserData(user, token);
      })
      .catch((error) => {
        chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: error.message });
      });
  });
}

async function storeUserData(user, token) {
  const userRef = doc(db, 'users', user.uid);
  const userData = {
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    lastLogin: serverTimestamp(),
    token: token
  };

  try {
    await setDoc(userRef, userData, { merge: true });
    const userDoc = await getDoc(userRef);
    const storedUserData = userDoc.data();
    chrome.runtime.sendMessage({ 
      action: 'signInResult', 
      success: true, 
      user: {
        displayName: storedUserData.displayName,
        email: storedUserData.email,
        photoURL: storedUserData.photoURL,
        lastLogin: storedUserData.lastLogin.toDate().toISOString()
      }
    });
  } catch (error) {
    console.error('Error storing user data:', error);
    chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: error.message });
  }
}

function sendAuthState() {
  const user = auth.currentUser;
  if (user) {
    getUserData(user.uid);
  } else {
    chrome.runtime.sendMessage({ action: 'signOutResult', success: true });
  }
}

async function getUserData(uid) {
  try {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      const userData = userDoc.data();
      chrome.runtime.sendMessage({ 
        action: 'signInResult', 
        success: true, 
        user: {
          displayName: userData.displayName,
          email: userData.email,
          photoURL: userData.photoURL,
          lastLogin: userData.lastLogin.toDate().toISOString()
        }
      });
    } else {
      chrome.runtime.sendMessage({ action: 'signOutResult', success: true });
    }
  } catch (error) {
    console.error('Error getting user data:', error);
    chrome.runtime.sendMessage({ action: 'signInResult', success: false, error: error.message });
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('User is signed in');
  } else {
    console.log('User is signed out');
  }
});
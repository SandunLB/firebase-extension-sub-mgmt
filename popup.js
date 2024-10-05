document.addEventListener('DOMContentLoaded', function() {
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const userInfo = document.getElementById('user-info');
  const loginContainer = document.getElementById('login-container');
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  const userAvatar = document.getElementById('user-avatar');
  const statusMessage = document.getElementById('status-message');
  const subscriptionStatus = document.getElementById('subscription-status');
  const subscriptionOptions = document.getElementById('subscription-options');
  const monthlyPlan = document.getElementById('monthly-plan');
  const yearlyPlan = document.getElementById('yearly-plan');
  const lifetimePlan = document.getElementById('lifetime-plan');

  loginButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'signIn' });
  });

  logoutButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'signOut' });
  });

  monthlyPlan.addEventListener('click', () => initiateSubscription('monthly'));
  yearlyPlan.addEventListener('click', () => initiateSubscription('yearly'));
  lifetimePlan.addEventListener('click', () => initiateSubscription('lifetime'));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'signInResult') {
      if (message.success) {
        updateUserInfo(message.user);
        checkSubscriptionStatus(message.user.uid);
      } else {
        statusMessage.textContent = 'Sign-in failed. Please try again.';
      }
    } else if (message.action === 'signOutResult') {
      if (message.success) {
        updateUserInfo(null);
      } else {
        statusMessage.textContent = 'Sign-out failed. Please try again.';
      }
    } else if (message.action === 'subscriptionStatus') {
      updateSubscriptionStatus(message.status);
    }
  });

  function updateUserInfo(user) {
    if (user) {
      userName.textContent = user.displayName;
      userEmail.textContent = user.email;
      userAvatar.src = user.photoURL || 'default-avatar.png';
      userInfo.style.display = 'block';
      loginContainer.style.display = 'none';
    } else {
      userInfo.style.display = 'none';
      loginContainer.style.display = 'block';
      subscriptionStatus.textContent = 'Checking...';
    }
  }

  function updateSubscriptionStatus(status) {
    subscriptionStatus.textContent = status ? `Active (${status.plan})` : 'Inactive';
    subscriptionOptions.style.display = status ? 'none' : 'block';
  }

  function initiateSubscription(plan) {
    statusMessage.textContent = 'Initiating subscription...';
    chrome.runtime.sendMessage({ action: 'initiateSubscription', plan });
  }

  function checkSubscriptionStatus(uid) {
    chrome.runtime.sendMessage({ action: 'checkSubscription', uid });
  }

  // Check initial auth state
  chrome.runtime.sendMessage({ action: 'getAuthState' });
});
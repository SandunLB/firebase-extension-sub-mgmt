document.addEventListener('DOMContentLoaded', function() {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const userInfo = document.getElementById('user-info');
    const loginContainer = document.getElementById('login-container');
    const userName = document.getElementById('user-name');
    const userEmail = document.getElementById('user-email');
    const lastLogin = document.getElementById('last-login');
    const userAvatar = document.getElementById('user-avatar');
    const statusMessage = document.getElementById('status-message');
  
    loginButton.addEventListener('click', () => {
      statusMessage.textContent = 'Signing in...';
      chrome.runtime.sendMessage({ action: 'signIn' });
    });
  
    logoutButton.addEventListener('click', () => {
      statusMessage.textContent = 'Signing out...';
      chrome.runtime.sendMessage({ action: 'signOut' });
    });
  
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'signInResult') {
        if (message.success) {
          updateUserInfo(message.user);
          statusMessage.textContent = 'Signed in successfully!';
        } else {
          console.error('Sign-in error:', message.error);
          statusMessage.textContent = 'Sign-in failed. Please try again.';
        }
      } else if (message.action === 'signOutResult') {
        if (message.success) {
          updateUserInfo(null);
          statusMessage.textContent = 'Signed out successfully!';
        } else {
          console.error('Sign-out error:', message.error);
          statusMessage.textContent = 'Sign-out failed. Please try again.';
        }
      }
    });
  
    function updateUserInfo(user) {
      if (user) {
        userName.textContent = user.displayName;
        userEmail.textContent = user.email;
        lastLogin.textContent = user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A';
        userAvatar.src = user.photoURL || 'default-avatar.png';
        userInfo.style.display = 'block';
        loginContainer.style.display = 'none';
      } else {
        userInfo.style.display = 'none';
        loginContainer.style.display = 'block';
      }
    }
  
    // Check initial auth state
    chrome.runtime.sendMessage({ action: 'getAuthState' });
  });
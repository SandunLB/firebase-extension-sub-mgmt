document.addEventListener("DOMContentLoaded",(function(){const e=document.getElementById("login-button"),t=document.getElementById("logout-button"),n=document.getElementById("user-info"),o=document.getElementById("login-container"),s=document.getElementById("user-name"),i=document.getElementById("user-email"),l=document.getElementById("last-login");function r(e){e?(s.textContent=e.displayName,i.textContent=e.email,l.textContent=e.lastLogin?new Date(e.lastLogin).toLocaleString():"N/A",n.style.display="block",o.style.display="none"):(n.style.display="none",o.style.display="block")}e.addEventListener("click",(()=>{chrome.runtime.sendMessage({action:"signIn"})})),t.addEventListener("click",(()=>{chrome.runtime.sendMessage({action:"signOut"})})),chrome.runtime.onMessage.addListener(((e,t,n)=>{"signInResult"===e.action?e.success?r(e.user):console.error("Sign-in error:",e.error):"signOutResult"===e.action&&(e.success?r(null):console.error("Sign-out error:",e.error))})),chrome.runtime.sendMessage({action:"getAuthState"})}));
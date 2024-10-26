This project is a simple subscription management system for browser extensions, built using **Firebase** for user authentication and **Stripe** for payments. It enables secure sign-ups and logins with Firebase Authentication, handles payments with Stripe, and stores subscription data in Firebase Firestore, making it easy to check users’ subscription status directly from your extension.

With this setup, users can:
- **Sign Up and Log In**: Firebase Authentication allows for easy and secure sign-up and login processes, with support for email/password or other sign-in methods.
- **Subscribe to Paid Plans**: Stripe handles payment processing, allowing users to securely subscribe to monthly or annual plans.
- **Access Subscription Data**: Subscription status is stored in Firebase Firestore, enabling quick and easy access within the extension to check active, expired, or canceled subscriptions.
- **Automate Billing**: Stripe's billing system manages renewals, reminders, and cancellations, simplifying subscription management.

This system is built with extensibility in mind, making it easy to integrate with any browser extension that requires paid access or premium features.

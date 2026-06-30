# GeoTechLogger Android App — Build & Install Guide

## Step 1 — Install tools (once only)
Open CMD and run:
```
npm install -g expo-cli eas-cli
```

## Step 2 — Install dependencies
```
cd C:\GeoTechLoggerApp
npm install
```

## Step 3 — Test on phone immediately (no build needed)
1. Install **Expo Go** from Google Play Store on your Android phone
2. Run: `npx expo start`
3. Scan the QR code with Expo Go — the app runs instantly

## Step 4 — Build a real APK (distributable, no Expo Go needed)
1. Create a free account at https://expo.dev
2. Login: `eas login`
3. Build: `eas build --platform android --profile preview`
4. Wait ~10 min — Expo cloud builds the APK
5. Download the .apk file from the link shown
6. Send the .apk to your phone and install it
   (Enable "Install from unknown sources" in Android Settings)

## Features
- Create jobs and boreholes
- Add soil layer entries with type, depth, description
- Generate borehole log PDF on-device (no PC server needed)
- Share PDF via email, Drive, WhatsApp, etc.
- All data saved locally on phone

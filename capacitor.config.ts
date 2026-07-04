import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.noqyris.exactly67',
  appName: 'Exactly 67',
  webDir: 'dist',
  // Match the game background so there is no white flash while the web view loads.
  backgroundColor: '#F6EEDF',
  ios: {
    contentInset: 'never',
  },
}

export default config

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import App from './App.jsx'
import { WalletContextProvider } from './components/WalletContextProvider.jsx'
import './index.css'

window.Buffer ||= Buffer

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WalletContextProvider>
      <App />
    </WalletContextProvider>
  </StrictMode>
)

import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = { title: 'WorkTree Orchestrator' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#070a0e] text-[#cdd9e5]">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

"use client";

import { ArrowLeft, Send } from 'lucide-react'

export default function ContactPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Return to Protocol</a>
      </div>
      
      <p className="eyebrow">TRANSMIT / 02</p>
      <h1 style={{ fontSize: 'clamp(42px, 5vw, 70px)', letterSpacing: '-0.05em' }}>Ping the Core.</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4rem', marginTop: '3rem' }}>
        <div className="legal-content">
          <p className="lead">Got a problem? Found a critical memory leak? Want to wire us $5M in VC funding? <br/><br/>Fill out the form. It routes directly to our on-call pagers.</p>
        </div>
        
        <form 
          action="https://formsubmit.co/aryansharma24112003@gmail.com" 
          method="POST" 
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', background: 'var(--surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}
        >
          {/* FormSubmit Config */}
          <input type="hidden" name="_next" value="http://localhost:3000/contact/success" />
          <input type="hidden" name="_captcha" value="false" />
          <input type="hidden" name="_subject" value="New TRANSMISSION from Cortex Website!" />

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600, fontSize: '13px', color: 'var(--secondary)' }}>
            Designation (Name)
            <input 
              type="text" 
              name="name" 
              required 
              placeholder="10x Architect"
              style={{ padding: '0.85rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px' }}
            />
          </label>
          
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600, fontSize: '13px', color: 'var(--secondary)' }}>
            Return Address (Email)
            <input 
              type="email" 
              name="email" 
              required 
              placeholder="engineer@localhost.com"
              style={{ padding: '0.85rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600, fontSize: '13px', color: 'var(--secondary)' }}>
            Payload (Message)
            <textarea 
              name="message" 
              required 
              rows={5}
              placeholder="The context window limit is an illusion. Let's talk..."
              style={{ padding: '0.85rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', fontFamily: 'inherit', resize: 'vertical' }}
            ></textarea>
          </label>

          <button type="submit" className="button" style={{ marginTop: '0.5rem', width: '100%' }}>
            Transmit Payload <Send size={15}/>
          </button>
        </form>
      </div>
    </main>
  )
}

"use client";

import { ArrowLeft, Send } from 'lucide-react'

export default function ContactPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Back to home</a>
      </div>
      
      <p className="eyebrow">YAP AT US</p>
      <h1>Contact Cortex</h1>
      
      <div className="legal-content" style={{ marginTop: '2rem', maxWidth: '600px' }}>
        <p>Got a problem? Found a bug? Want to wire us $5M in VC funding? <br/>Fill out the form below. It goes straight to the founder's phone.</p>
        
        <form 
          action="https://formsubmit.co/aryansharma24112003@gmail.com" 
          method="POST" 
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}
        >
          {/* FormSubmit Config */}
          <input type="hidden" name="_next" value="http://localhost:3000/contact/success" />
          <input type="hidden" name="_captcha" value="false" />
          <input type="hidden" name="_subject" value="New YAP from Cortex Website!" />

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
            Your Name (or alias)
            <input 
              type="text" 
              name="name" 
              required 
              placeholder="Gigachad Dev"
              style={{ padding: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px' }}
            />
          </label>
          
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
            Your Email
            <input 
              type="email" 
              name="email" 
              required 
              placeholder="chad@based.com"
              style={{ padding: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontWeight: 600 }}>
            Your Message
            <textarea 
              name="message" 
              required 
              rows={5}
              placeholder="Big Tech is cooked. Let's talk..."
              style={{ padding: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', fontFamily: 'inherit' }}
            ></textarea>
          </label>

          <button type="submit" className="button" style={{ marginTop: '1rem', width: 'fit-content' }}>
            Send Message <Send size={15}/>
          </button>
        </form>
      </div>
    </main>
  )
}

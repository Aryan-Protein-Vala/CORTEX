"use client";

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, CheckCircle } from 'lucide-react'

export default function ContactPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      message: formData.get('message'),
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setSubmitting(false);
        setSubmitted(true);
        router.push('/contact/success');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to transmit message.');
        setSubmitting(false);
      }
    } catch {
      setError('Network error reaching the Core.');
      setSubmitting(false);
    }
  };

  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Return to Protocol</a>
      </div>
      
      <p className="eyebrow">TRANSMIT / 02</p>
      <h1 style={{ fontSize: 'clamp(42px, 5vw, 70px)', letterSpacing: '-0.05em' }}>Ping the Core.</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4rem', marginTop: '3rem' }}>
        <div className="legal-content">
          <p className="lead">Got a problem? Found a critical memory leak? Want to wire us $5M in VC funding? <br/><br/>Fill out the form. It routes directly to our on-call engineers.</p>
        </div>
        
        <form 
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', background: 'var(--surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}
        >
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

          <button type="submit" disabled={submitting || submitted} className="button" style={{ marginTop: '0.5rem', width: '100%' }}>
            {submitting ? 'Transmitting...' : submitted ? 'Transmitted' : 'Transmit Payload'} {submitted ? <CheckCircle size={15}/> : <Send size={15}/>}
          </button>
        </form>
      </div>
    </main>
  )
}

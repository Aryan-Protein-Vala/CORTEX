import { ArrowLeft, CheckCircle } from 'lucide-react'

export default function SuccessPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem', textAlign: 'center', minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      
      <CheckCircle size={64} style={{ color: 'var(--accent)', marginBottom: '2rem' }} />
      <h1>Message Sent.</h1>
      
      <div className="legal-content" style={{ marginTop: '1rem', maxWidth: '600px', margin: '0 auto' }}>
        <p className="lead">The founder has received your yap. We will get back to you shortly if you're based enough.</p>
        
        <div style={{ marginTop: '3rem' }}>
          <a href="/" className="button ghost">Return to Hive Mind <ArrowLeft size={15}/></a>
        </div>
      </div>
    </main>
  )
}

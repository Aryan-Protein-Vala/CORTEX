import { ArrowLeft } from 'lucide-react'

export default function TermsPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Back to home</a>
      </div>
      
      <p className="eyebrow">LEGAL SHIT / 01</p>
      <h1>Terms of Service</h1>
      
      <div className="legal-content" style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px' }}>
        
        <section>
          <h3>1. Acceptance of Terms</h3>
          <p>By accessing Cortex, you agree to be bound by these Terms of Service. If you don't agree, close the tab and go back to paying linear token fees. It's really that simple.</p>
        </section>

        <section>
          <h3>2. Parody & Satire Disclaimer (Important)</h3>
          <p><strong>Look, lawyers:</strong> The marketing copy on this website claiming that Big Tech companies (like OpenAI, Google, Anthropic, Meta) are "terrified," "scamming you," or "brain-dead" is entirely satirical and constitutes protected parody/puffery. We do not have insider knowledge of Sam Altman's emotional state, nor are we accusing any corporation of actual legal fraud. We are just tired developers making a hyper-exaggerated joke about the very real technical limitations of LLM context windows (which we actually love and use constantly). Please do not sue us; we spend all our money on server costs anyway.</p>
        </section>

        <section>
          <h3>3. Use of the Protocol</h3>
          <p>Cortex is an open infrastructure protocol. You are free to use it, self-host it, or build upon it via our open-source repositories. If you use our hosted Cortex Cloud, don't spam our APIs. If you do, we will rate-limit you into oblivion.</p>
        </section>

        <section>
          <h3>4. Limitation of Liability</h3>
          <p>Cortex is provided "as is". If our Ebbinghaus Decay algorithm accidentally deletes the memory of your grandmother's birthday because your "Impact" score was too low, that is a skill issue on your part. We are not liable for lost data, hurt feelings, or AI hallucinations.</p>
        </section>

        <section>
          <h3>5. Changes to Terms</h3>
          <p>We can update these terms at any time. We probably won't email you about it unless it's legally required.</p>
        </section>
        
      </div>
    </main>
  )
}

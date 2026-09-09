import { ArrowLeft } from 'lucide-react'

export default function PrivacyPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Back to home</a>
      </div>
      
      <p className="eyebrow">LEGAL SHIT / 02</p>
      <h1>Privacy Policy</h1>
      
      <div className="legal-content" style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px' }}>
        
        <section>
          <h3>1. Data Collection</h3>
          <p>We built Cortex because we hate centralized data silos. If you use the open-source self-hosted version, we collect literally nothing. If you use Cortex Cloud to sync your devices, we collect your JSON-LD semantic triplets so they can be synced. That's the whole point of the product.</p>
        </section>

        <section>
          <h3>2. Third-Party AI Models</h3>
          <p>When Cortex extracts memories using the "Shadow Kernel", your raw chat logs are sent to third-party LLM providers (like OpenRouter, OpenAI, or Anthropic) solely for the purpose of JSON extraction. You are bound by their respective privacy policies. We do not use your memory graph to train our own models, because we aren't building a model, we are building a database.</p>
        </section>

        <section>
          <h3>3. Data Retention and Deletion (The Ebbinghaus Clause)</h3>
          <p>Ironically, our entire architecture is built around forgetting things. If your memory retention probability `R(t)` drops below 0.05, it gets mathematically purged from the graph forever. If you want to manually delete your entire brain before the math does it for you, you can do so at any time in your account settings.</p>
        </section>

        <section>
          <h3>4. Cookies</h3>
          <p>We use local storage for basic UI shit like keeping the dark mode turned on. We don't use creepy cross-site tracking pixels because we don't care what shoes you looked at on Amazon.</p>
        </section>
        
      </div>
    </main>
  )
}

import { ArrowLeft } from 'lucide-react'

export default function AboutPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Back to home</a>
      </div>
      
      <p className="eyebrow">THE LORE / 01</p>
      <h1>Based About Us</h1>
      
      <div className="legal-content" style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px' }}>
        
        <section>
          <h3>The Origin Story</h3>
          <p>We didn't start this company because we wanted to change the world. We started it out of pure, unadulterated rage. One day, after having to explain the exact same fucking architectural context to Claude for the 50th time in a week, we snapped.</p>
          <p>Big Tech wants you to believe that the solution to AI amnesia is to just give them more money for bigger context windows. 128k tokens! 1 million tokens! It's a scam. You are paying linear token fees for exponential memory loss.</p>
        </section>

        <section>
          <h3>The Philosophy</h3>
          <p>AI models shouldn't hold memory. They should just compute. The memory should belong to YOU, locally, stored in a mathematical graph that never forgets. Cortex was built to decouple your brain from OpenAI's servers.</p>
        </section>

        <section>
          <h3>The License</h3>
          <p>We open-sourced this under the AGPLv3 license. That means you are free to take our code, run it yourself, and hack it to pieces. But if you try to wrap a proprietary API around it and sell it without open-sourcing your own changes, our lawyers will personally hunt you down. Based.</p>
        </section>
        
      </div>
    </main>
  )
}

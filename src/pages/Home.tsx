import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Bot, BarChart3, Cable, Workflow, LayoutDashboard, Users } from 'lucide-react'
import { useState } from 'react'
import { profile, tools, services, steps, cases, stats, experience, demos } from '../content'
import { DemoShowcase } from '../components/DemoShowcase'
import { WorkflowGallery } from '../components/WorkflowGallery'
import { Starfield } from '../components/Starfield'
import { HeroRobot } from '../components/HeroRobot'
import { BookingModal, useBooking } from '../components/BookingModal'
import { Reveal, Enter } from '../components/Reveal'
import './pan-furniture.css'

const icons: Record<string, React.JSX.Element> = {
  workflow: <Workflow size={20} />, bot: <Bot size={20} />, crm: <Users size={20} />, app: <LayoutDashboard size={20} />, data: <Cable size={20} />, chart: <BarChart3 size={20} />,
}

/* Portrait: uses public/joe.jpg when present, otherwise the initials block */
function Portrait() {
  const [missing, setMissing] = useState(false)
  if (missing || !profile.photo) return <div className="person-photo person-photo--initials"><span>{profile.initials}</span></div>
  return <img className="person-photo" src={profile.photo} alt={profile.name} onError={() => setMissing(true)} />
}

const roles = [
  ...experience.map((x) => ({ title: x.role, org: x.company, kind: x.where, when: x.when, desc: `${x.about} ${x.bullets[0]}`, tags: x.stack })),
]

export default function Home() {
  const [showAllRoles, setShowAllRoles] = useState(false)
  const [openService, setOpenService] = useState<string | null>(null)
  const booking = useBooking()
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a href="#hero" className="brand"><span className="brand-mark">JM</span>Joe Marie Casela</a>
          <nav className="nav-links">
            <a href="#work">Work</a><a href="#services">Services</a><a href="#process">Process</a><a href="#experience">Experience</a><a href="#about">About</a>
          </nav>
          <a {...booking.props} className="btn btn-primary btn-sm">Book a call <ArrowRight size={14} /></a>
        </div>
      </header>

      <section id="hero" className="hero">
        <Starfield className="hero-stars" />
        <div className="hero-fade" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <Enter as="p" className="eyebrow on-dark" y={12} delay={0.1} duration={0.5}>{demos.length} live products · enterprise automation</Enter>
            <Enter className="hero-h1" y={20} delay={0.25} duration={0.55}>
              <h1>Internal platforms and AI automation that give operations leaders control of the numbers. <span>Reliable. Auditable. Yours.</span></h1>
            </Enter>
            <Enter as="p" className="lede" y={16} delay={0.5}>
              Purchasing intelligence, CRM automation, AI agents and ERP-to-storefront integrations &mdash; shipped as production systems your team owns.
            </Enter>
            <Enter className="hero-cta" y={16} delay={0.65}>
              <a {...booking.props} className="btn btn-accent">Book a free call &rarr;</a>
              <a href="#work" className="btn btn-ghost btn-ghost-dark">See the work &darr;</a>
            </Enter>
            <Enter as="p" className="hero-note" y={12} delay={0.8} duration={0.5}><b>Complimentary 30-minute assessment.</b> You leave with a documented view of the bottleneck &mdash; with or without an engagement.</Enter>
          </div>
          <Enter className="hero-robot" delay={0.4} duration={1} y={0} scale={0.95}>
            <div className="hero-robot-in">
              <div className="hero-robot-edge" aria-hidden="true" />
              <HeroRobot />
            </div>
          </Enter>
        </div>
      </section>

      <div className="marquee-wrap" aria-hidden>
        <div className="marquee">
          {[...tools, ...tools].map((t, i) => (
            <span key={i}>
              {t.icon
                ? <img src={`https://cdn.simpleicons.org/${t.icon}/${t.color}`} alt="" width={18} height={18} decoding="async" />
                : t.logo
                  ? <img src={t.logo} alt="" width={18} height={18} decoding="async" className="tool-logo" />
                  : <i className="tool-badge" style={{ background: `#${t.color}` }}>{t.initials}</i>}
              {t.name}
            </span>
          ))}
        </div>
      </div>

      <section id="process">
        <div className="container">
          <Reveal className="section-head" amount={0.3}>
            <p className="eyebrow">Delivery model</p>
            <h2>A governed path from audit to production.</h2>
            <p>Fixed scope, approved design, measurable outcomes &mdash; every engagement follows the same three stages.</p>
          </Reveal>
          <div className="steps">
            {steps.map((s, i) => (
              <Reveal as="article" className="step" key={s.title} y={18} delay={i * 0.09} duration={0.5}>
                <span className="num">STEP 0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="deliver">You get: <b>{s.deliver}</b></div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="work">
        <div className="container">
          <Reveal amount={0.1}><DemoShowcase /></Reveal>

          <Reveal className="subhead">
            <h3>Automation case studies</h3>
            <span>n8n · Gmail · Facebook Graph · Maya · Kie.ai · Supabase</span>
          </Reveal>
          <div className="case-grid">
            {cases.map((c, i) => (
              <Reveal as="article" className="case" key={c.title} y={18} delay={(i % 3) * 0.09} duration={0.5}>
                <div className="tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>{c.tools.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                <h3>{c.title}</h3>
                <p>{c.blurb}</p>
                <div className="ps">
                  <div><b>Problem</b>{c.problem}</div>
                  <div><b>Solution</b>{c.solution}</div>
                </div>
                <div className="metric"><strong>{c.metric}</strong><span>{c.metricLabel}</span></div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="workflows">
        <Reveal className="container" amount={0.15}>
          <WorkflowGallery />
        </Reveal>
      </section>

      <section id="services">
        <div className="container">
          <Reveal className="svc-head" amount={0.3}>
            <p className="eyebrow">Capabilities</p>
            <h2>Systems I design <span>and deliver.</span></h2>
            <p>Automation and internal platforms for operations, finance and commerce teams that need dependable systems, not slideware.</p>
          </Reveal>
          <div className="svc-list">
            {services.map((sv, i) => {
              const open = openService === sv.title
              return (
                <Reveal as="article" className={'svc-row' + (open ? ' open' : '')} key={sv.title} y={14} delay={Math.min(i, 2) * 0.1} duration={0.45} amount={0.25}>
                  <span className="svc-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="svc-title">{sv.title}</h3>
                  <div className="svc-body">
                    <p className="svc-blurb">{sv.blurb}</p>
                    <div className="svc-you"><b>You get</b><ul>{sv.bullets.map((bl) => <li key={bl}>{bl}</li>)}</ul></div>
                    {open && (
                      <div className="svc-detail">
                        <p>{sv.detail}</p>
                        <a href="#contact" className="svc-cta">Discuss a similar build <ArrowRight size={14} /></a>
                      </div>
                    )}
                  </div>
                  <button type="button" className="svc-more" aria-expanded={open} onClick={() => setOpenService(open ? null : sv.title)}>{open ? 'Close \u2191' : 'Read more \u2192'}</button>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      <section id="results">
        <div className="container">
          <Reveal className="section-head" amount={0.3}>
            <p className="eyebrow">Outcomes</p>
            <h2>Measured results from systems in production.</h2>
          </Reveal>
          <div className="stats">
            {stats.map((s, i) => (
              <Reveal className="stat" key={s.label} y={18} delay={i * 0.09} duration={0.5}>
                <small>{s.kicker}</small>
                <strong>{s.value}<em>{s.suffix}</em></strong>
                <span>{s.label}</span>
                <a href={s.link} className="stat-link">{s.cta} <ArrowUpRight size={13} /></a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container">
          <Reveal amount={0.3}>
            <p className="eyebrow">Principal consultant</p>
            <h2 className="person-name">{profile.name}</h2>
          </Reveal>
          <Reveal className="person-grid" amount={0.15} delay={0.1}>
            <aside className="person-side">
              <Portrait />
            </aside>
            <div className="person-main">
              <p className="person-specs">{profile.specialties.join(' \u2022 ')}</p>
              <p className="person-loc">@ {profile.location.toUpperCase()}</p>
              <div className="person-bio">
                <p>I design and deliver the internal platforms and automation that operations, finance and commerce teams run on: order intake to invoicing, procurement to inventory, lead capture to CRM pipeline. Every figure on screen traces back to the operating tables the work is done in.</p>
                <p>Delivery stack: <strong>n8n</strong>, <strong>Make.com</strong>, <strong>Zapier</strong>, <strong>GoHighLevel</strong>, <strong>Gemini</strong> and <strong>OpenAI</strong> for automation and agents; <strong>React</strong>, <strong>Next.js</strong>, <strong>Node</strong> and <strong>Supabase</strong> for the platforms those workflows live in &mdash; across manufacturing, retail and e-commerce.</p>
              </div>
              <p className="eyebrow" id="experience" style={{ marginTop: '2.4rem' }}>Experience</p>
              <h3 className="person-xp-title">Experience <span>&amp; engagements.</span></h3>
              <div className="roles">
                {(showAllRoles ? roles : roles.slice(0, 3)).map((x) => (
                  <article className="role" key={x.title + x.org}>
                    <div className="role-head">
                      <div>
                        <h4>{x.title}</h4>
                        <p className="role-org">{x.org} &middot; {x.kind}</p>
                      </div>
                      <span className="role-when">{x.when}</span>
                    </div>
                    <p className="role-desc">{x.desc}</p>
                    <div className="role-tags">{x.tags.map((t) => <span key={t}>{t}</span>)}</div>
                  </article>
                ))}
              </div>
              {roles.length > 3 && (
                <button type="button" className="roles-more" onClick={() => setShowAllRoles((v) => !v)}>
                  {showAllRoles ? 'Show fewer roles \u2191' : `Show all ${roles.length} roles \u2193`}
                </button>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="contact">
        <Reveal className="container contact-center" amount={0.3}>
          <p className="eyebrow on-dark">Engage</p>
          <h2>Start with an operational assessment. <span>No commitment required.</span></h2>
          <p className="lede">A 30-minute call to scope the problem, the systems involved and what a fixed-scope engagement would cover.</p>
          <div className="hero-cta contact-cta">
            <a {...booking.props} className="btn btn-accent">Book a 30-minute call</a>
            <a href={profile.linkedin} target="_blank" rel="noreferrer" className="btn btn-ghost btn-ghost-dark">Message on LinkedIn <ArrowUpRight size={16} /></a>
          </div>
        </Reveal>
      </section>
      <BookingModal open={booking.open} onClose={() => booking.setOpen(false)} />
      <footer className="footer">
        <div className="container">
          <span>&copy; 2026 {profile.name} &middot; <a href={profile.site} target="_blank" rel="noreferrer">workwithjm.onrender.com</a></span>
          <span className="footer-links">
            <a href={profile.linkedin} target="_blank" rel="noreferrer">LinkedIn</a> &middot; <a href={profile.upwork} target="_blank" rel="noreferrer">Upwork</a> &middot; <a href={profile.onlinejobs} target="_blank" rel="noreferrer">OnlineJobs.ph</a> &middot; <a href={profile.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> &middot; <a href={profile.viber}>Viber</a> &middot; <a href={`mailto:${profile.email}`}>Email</a>
          </span>
          <span className="footer-status"><i /> All systems online</span>
        </div>
      </footer>
    </>
  )
}

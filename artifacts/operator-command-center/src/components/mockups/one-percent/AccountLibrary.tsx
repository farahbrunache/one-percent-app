import { useState } from 'react';
import { BookOpen, Check, ChevronRight, FileText, Link2, LogIn, Mail, Search, UserRound } from 'lucide-react';
import {
  AlertBox,
  BackLabel,
  Card,
  CodeLine,
  Field,
  PhoneShell,
  PreviewStates,
  PrimaryButton,
  SectionLabel,
  StatusPill,
  TrustLine,
} from './_shared/Ui';

type AccountState = 'signed-out' | 'sign-in' | 'no-session' | 'library' | 'sheet' | 'link' | 'failed';

const states: { value: AccountState; label: string }[] = [
  { value: 'signed-out', label: 'signed out' },
  { value: 'sign-in', label: 'signing in' },
  { value: 'no-session', label: 'no session' },
  { value: 'library', label: 'your sessions' },
  { value: 'sheet', label: 'read sheet' },
  { value: 'link', label: 'paste claim link' },
  { value: 'failed', label: 'link failed' },
];

export function AccountLibrary() {
  const [state, setState] = useState<AccountState>('library');
  const [email, setEmail] = useState('');
  const [claimLink, setClaimLink] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <PhoneShell
      eyebrow="one percent / account"
      title={state === 'sheet' ? 'The sheet' : 'Your sessions'}
      subtitle={state === 'signed-out' ? 'Sign in only when there is a session or sheet to keep.' : 'An account keeps the sessions and sheets attached to one place. Nothing is written from here.'}
      footer={<TrustLine>Read only · no reply form</TrustLine>}
    >
      <PreviewStates value={state} options={states} onChange={(value) => { setState(value); setSent(false); }} />

      {state === 'signed-out' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={LogIn}>signed out</SectionLabel>
          <Card tone="gold">
            <div className="flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4b3a24] text-[#e7c982]"><UserRound size={17} /></div><div><div className="text-[12px] font-bold text-[#f0ddb0]">Nothing is attached to an account</div><p className="mt-1 text-[10px] leading-[1.45] text-[#bca982]">A claim link still opens a paid session without signing in.</p></div></div>
          </Card>
          <PrimaryButton tone="gold" onClick={() => setState('sign-in')} className="w-full"><LogIn size={14} />Sign in</PrimaryButton>
          <button onClick={() => setState('link')} className="flex w-full items-center justify-center gap-2 py-2 text-[10px] font-bold text-[#9bb4a8] hover:text-[#ddb077]"><Link2 size={13} />Paste a claim link</button>
        </div>
      )}

      {state === 'sign-in' && (
        <div className="fade-in space-y-3">
          <BackLabel onClick={() => setState('signed-out')} />
          <SectionLabel icon={Mail}>sign in</SectionLabel>
          <Card><p className="text-[11px] leading-[1.5] text-[#9fb5ab]">Enter the email used for the account. A one-time sign-in link is sent. Signing in grants no session by itself.</p></Card>
          <Field label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" />
          <PrimaryButton tone="coral" onClick={() => { setSent(true); setState('no-session'); }} disabled={!email.includes('@')} className="w-full"><Mail size={14} />Send sign-in link</PrimaryButton>
          {sent && <AlertBox tone="sage">Sign-in link sent. The account has no linked session yet.</AlertBox>}
        </div>
      )}

      {state === 'no-session' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={UserRound}>signed in · no session</SectionLabel>
          <Card>
            <div className="flex items-center gap-2 text-[11px] font-bold text-[#d3e2da]"><UserRound size={15} />No session is linked</div>
            <p className="mt-2 text-[10px] leading-[1.45] text-[#9fb5ab]">This account exists, but there is no paid session attached to it. Paste the claim link from a purchase to add one.</p>
          </Card>
          <PrimaryButton tone="coral" onClick={() => setState('link')} className="w-full"><Link2 size={14} />Paste a claim link</PrimaryButton>
        </div>
      )}

      {state === 'library' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={BookOpen}>four sessions</SectionLabel><span className="mono text-[9px] text-[#71877f]">signed in</span></div>
          {[
            ['H8TF7-AFJYL', 'paid · not started', 'Start the call from the claim page', 'gold'],
            ['Q2LM9-RK4PE', 'started · nothing came back', 'The call did not return a record', 'coral'],
            ['M6DA2-KC8TU', 'called · waiting to be read', 'The operator is writing the sheet', 'gold'],
            ['P4NV1-JF3QX', 'read', 'Sheet written 12 Oct', 'sage'],
          ].map(([code, status, detail, tone]) => (
            <button key={code} onClick={() => status === 'read' ? setState('sheet') : setState('link')} className="flex w-full items-center justify-between rounded-2xl border border-[#344640] bg-[#1d2523] p-3 text-left transition hover:border-[#6a8f7d]">
              <div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">{code}</div><div className="mt-2"><StatusPill tone={tone as 'neutral' | 'sage' | 'coral' | 'gold'}>{status}</StatusPill></div><div className="mt-2 text-[10px] text-[#829991]">{detail}</div></div><ChevronRight size={16} className="text-[#78988a]" />
            </button>
          ))}
          <PrimaryButton tone="quiet" onClick={() => setState('link')} className="w-full"><Link2 size={14} />Link another session</PrimaryButton>
        </div>
      )}

      {state === 'sheet' && (
        <div className="fade-in space-y-3">
          <BackLabel onClick={() => setState('library')}>your sessions</BackLabel>
          <div className="flex items-center justify-between"><SectionLabel icon={FileText}>written sheet</SectionLabel><StatusPill tone="sage">read</StatusPill></div>
          <CodeLine code="P4NV1-JF3QX" />
          <Card tone="sage">
            <div className="mono text-[8px] uppercase tracking-[0.14em] text-[#83b89a]">written 12 Oct · one person, once</div>
            <h2 className="serif mt-2 text-[22px] leading-[1.05] text-[#e5efe9]">Make the first offer smaller.</h2>
            <div className="mt-4 space-y-3 text-[11px] leading-[1.55] text-[#b5cec0]">
              <p>Start with one buyer who already names the problem in the same words you use. Do not build the full service before that conversation.</p>
              <p>Write the offer as a fixed outcome, not a menu of capabilities. The first version should be deliverable in one afternoon.</p>
              <p>Ask for the payment before adding the second feature. The fact to protect is whether one person will pay once.</p>
            </div>
          </Card>
          <Card><div className="flex gap-2 text-[10px] leading-[1.45] text-[#9fb5ab]"><Check size={14} className="mt-0.5 shrink-0 text-[#8fc0a3]" />This sheet is read-only. There is no reply form.</div></Card>
          <div className="border-t border-[#2a3a36] pt-4"><SectionLabel icon={FileText}>quotes written</SectionLabel><div className="flex items-center justify-between rounded-xl border border-[#344640] bg-[#1d2523] px-3 py-2.5"><span className="text-[10px] text-[#9fb5ab]">Offer clarity review</span><span className="serif text-[20px] text-[#e3c18a]">$24</span></div><div className="mt-2 text-[9px] text-[#71877f]">Covers one written review of the offer and first-payment path.</div></div>
        </div>
      )}

      {state === 'link' && (
        <div className="fade-in space-y-3">
          <BackLabel onClick={() => setState('library')}>your sessions</BackLabel>
          <SectionLabel icon={Link2}>paste claim link</SectionLabel>
          <p className="text-[11px] leading-[1.5] text-[#9fb5ab]">Use the link from the purchase screen to attach a session to this account.</p>
          <Field label="Claim link" value={claimLink} onChange={setClaimLink} placeholder="onepercent.co/s/H8TF7-AFJYL" />
          <PrimaryButton tone="coral" onClick={() => setState('library')} disabled={!claimLink.trim()} className="w-full"><Link2 size={14} />Link session</PrimaryButton>
          <Card><div className="flex gap-2 text-[10px] leading-[1.45] text-[#9fb5ab]"><Search size={14} className="mt-0.5 shrink-0 text-[#d7b57f]" />The reference code stays usable even after linking.</div></Card>
        </div>
      )}

      {state === 'failed' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Link2}>claim link could not be linked</SectionLabel>
          <AlertBox>The link does not match a paid session. Check the full claim link, including the reference code, and try again. The purchase is not changed.</AlertBox>
          <Field label="Claim link" value={claimLink} onChange={setClaimLink} placeholder="onepercent.co/s/H8TF7-AFJYL" />
          <PrimaryButton tone="coral" onClick={() => setState('library')} disabled={!claimLink.trim()} className="w-full"><Link2 size={14} />Try linking again</PrimaryButton>
          <button onClick={() => setState('no-session')} className="w-full py-2 text-[9px] font-bold text-[#80978e] hover:text-[#ddb077]">Leave the account unchanged</button>
        </div>
      )}
    </PhoneShell>
  );
}
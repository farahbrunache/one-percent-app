import { useState } from 'react';
import { CheckCircle2, Clock3, Mic, PhoneCall, Play, UserRound, XCircle } from 'lucide-react';
import {
  AlertBox,
  BackLabel,
  CallTimer,
  Card,
  CodeLine,
  PhoneShell,
  PreviewStates,
  PrimaryButton,
  SectionLabel,
  StatusPill,
  TrustLine,
} from './_shared/Ui';

type ClaimState = 'order' | 'unmatched' | 'matched' | 'running' | 'ended' | 'failed' | 'empty' | 'failed-record';

const states: { value: ClaimState; label: string }[] = [
  { value: 'order', label: 'order' },
  { value: 'unmatched', label: 'not matched' },
  { value: 'matched', label: 'ready' },
  { value: 'running', label: 'running' },
  { value: 'ended', label: 'ended' },
  { value: 'failed', label: 'failed start' },
  { value: 'empty', label: 'no session' },
  { value: 'failed-record', label: 'record failed' },
];

export function SessionClaim() {
  const [state, setState] = useState<ClaimState>('matched');

  return (
    <PhoneShell
      eyebrow="one percent / claimed session"
      title="Your session"
      subtitle="Reference H8TF7-AFJYL. This page stays attached to the purchase whether or not an account exists."
      footer={<TrustLine>30-minute call · session H8TF7-AFJYL</TrustLine>}
    >
      <PreviewStates value={state} options={states} onChange={setState} />

      {state === 'order' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Clock3}>reading the order</SectionLabel>
          <Card tone="gold">
            <div className="flex items-end justify-between"><div><div className="mono text-[8px] uppercase tracking-[0.12em] text-[#b9a275]">one paid session</div><div className="serif mt-1 text-[38px] leading-none text-[#f4eadb]">$7</div></div><StatusPill tone="gold">paid</StatusPill></div>
            <p className="mt-4 border-t border-[#5b4b32] pt-3 text-[11px] leading-[1.5] text-[#c7b58e]">A half-hour voice call about one person, one possible offer, and the first paying customer.</p>
          </Card>
          <CodeLine code="H8TF7-AFJYL" />
          <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8fa59c]"><div className="rounded-xl border border-[#344640] bg-[#1d2523] p-3"><span className="block text-[#667d73]">paid</span><span className="mt-1 block font-bold text-[#ceddd5]">16 Oct · 08:42</span></div><div className="rounded-xl border border-[#344640] bg-[#1d2523] p-3"><span className="block text-[#667d73]">call length</span><span className="mt-1 block font-bold text-[#ceddd5]">30 minutes</span></div></div>
        </div>
      )}

      {state === 'unmatched' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Clock3}>paid, not matched yet</SectionLabel>
          <Card tone="gold">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-bold text-[#ead8a8]"><Clock3 size={15} />Payment is recorded</div><StatusPill tone="gold">waiting</StatusPill></div>
            <p className="mt-3 text-[11px] leading-[1.5] text-[#c7b58e]">The operator has not matched this purchase to a call slot yet. Keep this page. The start control appears here when it is ready.</p>
          </Card>
          <CodeLine code="H8TF7-AFJYL" />
          <Card><div className="flex gap-2 text-[10px] leading-[1.45] text-[#a6bbb3]"><UserRound size={14} className="mt-0.5 shrink-0 text-[#d7b57f]" />No account is needed while the session is being matched.</div></Card>
        </div>
      )}

      {state === 'matched' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={CheckCircle2}>matched and ready</SectionLabel>
          <Card tone="sage">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-bold text-[#b6d9c4]"><CheckCircle2 size={15} />A call slot is ready</div><StatusPill tone="sage">startable</StatusPill></div>
            <p className="mt-3 text-[11px] leading-[1.5] text-[#a8c6b6]">Use a quiet place and a microphone. The call covers one possible offer and the work to reach a first paying customer.</p>
          </Card>
          <PrimaryButton tone="coral" onClick={() => setState('running')} className="w-full"><Play size={14} fill="currentColor" />Start the call</PrimaryButton>
          <Card><div className="flex items-start gap-2 text-[10px] leading-[1.45] text-[#9fb5ab]"><Mic size={14} className="mt-0.5 shrink-0 text-[#d7b57f]" />The browser may ask for microphone access before the call begins.</div></Card>
        </div>
      )}

      {state === 'running' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={PhoneCall}>call running</SectionLabel>
          <CallTimer minutesLeft={13} />
          <Card tone="coral">
            <div className="flex items-center gap-2 text-[11px] font-bold text-[#f0c9bf]"><PhoneCall size={15} />The voice agent is listening</div>
            <p className="mt-2 text-[10px] leading-[1.45] text-[#c9a49c]">Say the thing you would charge one person for once. The call ends automatically at thirty minutes.</p>
          </Card>
          <div className="rounded-xl border border-dashed border-[#5b4843] bg-[#211b19] px-3 py-3 text-[10px] text-[#a88d85]">Do not close this page while the call is running.</div>
          <PrimaryButton tone="quiet" onClick={() => setState('ended')} className="w-full"><XCircle size={14} />End call</PrimaryButton>
        </div>
      )}

      {state === 'ended' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={CheckCircle2}>call ended</SectionLabel>
          <Card tone="sage">
            <div className="flex items-center gap-2 text-[11px] font-bold text-[#b6d9c4]"><CheckCircle2 size={15} />Call record received</div>
            <p className="mt-2 text-[11px] leading-[1.5] text-[#a8c6b6]">The operator reads the call and writes the sheet. The sheet will appear on this page when it is written.</p>
          </Card>
          <div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-[#344640] bg-[#1d2523] p-3"><span className="block text-[9px] text-[#667d73]">duration</span><span className="serif mt-1 block text-[23px] text-[#d4e2dc]">27m</span></div><div className="rounded-xl border border-[#344640] bg-[#1d2523] p-3"><span className="block text-[9px] text-[#667d73]">next</span><span className="mt-1 block text-[11px] font-bold text-[#b8d5c4]">sheet being written</span></div></div>
        </div>
      )}

      {state === 'failed' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={XCircle}>start failed</SectionLabel>
          <AlertBox>The call could not start because microphone access was not granted. Allow the microphone in the browser, then try this page again. If it persists, use the same claim link on another device.</AlertBox>
          <Card>
            <div className="flex items-center justify-between"><span className="text-[10px] text-[#8fa59c]">session remains</span><StatusPill tone="gold">paid</StatusPill></div>
            <div className="mt-3"><CodeLine code="H8TF7-AFJYL" /></div>
          </Card>
          <PrimaryButton tone="coral" onClick={() => setState('matched')} className="w-full"><Mic size={14} />Try microphone access again</PrimaryButton>
          <button onClick={() => setState('order')} className="w-full py-2 text-[9px] font-bold text-[#80978e] hover:text-[#ddb077]">Read the order</button>
        </div>
      )}

      {state === 'empty' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={XCircle}>no session found</SectionLabel>
          <AlertBox>No paid session matches this reference code. Check the code on the purchase handoff, then open the claim link again. If the code is correct, use the recovery route on the purchase screen.</AlertBox>
          <Card><CodeLine code="H8TF7-AFJYL" /></Card>
          <PrimaryButton tone="gold" onClick={() => setState('order')} className="w-full"><Clock3 size={14} />Read the order details</PrimaryButton>
        </div>
      )}

      {state === 'failed-record' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={XCircle}>call record unavailable</SectionLabel>
          <AlertBox>The call ended, but its record did not come back. The paid session remains attached to this reference. Try the call again from this page.</AlertBox>
          <Card tone="gold"><div className="flex items-center justify-between"><span className="text-[10px] text-[#8fa59c]">reference</span><StatusPill tone="gold">paid</StatusPill></div><div className="mt-3"><CodeLine code="H8TF7-AFJYL" /></div></Card>
          <PrimaryButton tone="coral" onClick={() => setState('matched')} className="w-full"><PhoneCall size={14} />Try the call again</PrimaryButton>
        </div>
      )}

      <div className="mt-6 border-t border-[#2a3a36] pt-4">
        <SectionLabel icon={UserRound}>keep it after the call</SectionLabel>
        <p className="text-[10px] leading-[1.45] text-[#829991]">Sign in to keep this session with an account. Signing in does not change the call or the sheet.</p>
      </div>
    </PhoneShell>
  );
}
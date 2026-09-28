import { useState } from 'react';
import { Check, CheckCircle2, ClipboardCheck, Search, X, XCircle } from 'lucide-react';
import {
  AlertBox,
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

type PaymentState = 'waiting' | 'confirm' | 'decline' | 'search' | 'confirmed';

const states: { value: PaymentState; label: string }[] = [
  { value: 'waiting', label: 'waiting' },
  { value: 'confirm', label: 'confirm one' },
  { value: 'decline', label: 'decline one' },
  { value: 'search', label: 'find reference' },
  { value: 'confirmed', label: 'confirmed' },
];

export function PaymentReview() {
  const [state, setState] = useState<PaymentState>('waiting');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');

  return (
    <PhoneShell
      eyebrow="one percent / operator payments"
      title="Confirm money"
      subtitle="A separate operator screen for money that has arrived but is not yet attached to a session."
      footer={<TrustLine>Operator-only · every action is reversible</TrustLine>}
    >
      <PreviewStates value={state} options={states} onChange={(value) => { setState(value); setResult(''); }} />

      {state === 'waiting' && (
        <div className="fade-in space-y-3">
          <div className="flex items-center justify-between"><SectionLabel icon={ClipboardCheck}>waiting to confirm</SectionLabel><StatusPill tone="gold">3 items</StatusPill></div>
          {[
            ['H8TF7-AFJYL', 'Wise', 'arrived 08:42', '$7'],
            ['Q2LM9-RK4PE', 'Gift card', 'submitted 08:18', '$7'],
            ['M6DA2-KC8TU', 'Wise', 'arrived yesterday', '$7'],
          ].map(([code, route, time, amount]) => (
            <button key={code} onClick={() => setState('confirm')} className="flex w-full items-center justify-between rounded-2xl border border-[#344640] bg-[#1d2523] p-3 text-left transition hover:border-[#6a8f7d]">
              <div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">{code}</div><div className="mt-2 flex items-center gap-2 text-[9px] text-[#839a90]"><span>{route}</span><span className="text-[#4c6159]">·</span><span>{time}</span></div></div><div className="serif text-[23px] text-[#cce0d4]">{amount}</div>
            </button>
          ))}
          <Card tone="gold"><div className="flex gap-2 text-[10px] leading-[1.45] text-[#c7b58e]"><Search size={14} className="mt-0.5 shrink-0" />Search a reference when somebody sends a code outside this queue.</div></Card>
        </div>
      )}

      {state === 'confirm' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={CheckCircle2}>confirm payment</SectionLabel>
          <Card tone="sage">
            <div className="flex items-center justify-between"><div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">H8TF7-AFJYL</div><div className="mt-2 text-[10px] text-[#9bb7a7]">Wise · arrived 16 Oct · 08:42</div></div><div className="serif text-[30px] text-[#b9dec9]">$7</div></div>
            <div className="mt-4 border-t border-[#385848] pt-3 text-[10px] leading-[1.45] text-[#a8c6b6]">Confirming creates the session reference and claim link. Declining removes it from the waiting list.</div>
          </Card>
          <PrimaryButton tone="sage" onClick={() => setState('confirmed')} className="w-full"><Check size={14} />Confirm money arrived</PrimaryButton>
          <PrimaryButton tone="quiet" onClick={() => setState('decline')} className="w-full"><X size={14} />Decline this payment</PrimaryButton>
        </div>
      )}

      {state === 'decline' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={XCircle}>decline payment</SectionLabel>
          <Card tone="coral"><div className="flex items-center justify-between"><div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">Q2LM9-RK4PE</div><div className="mt-2 text-[10px] text-[#c29b92]">Gift card · submitted 16 Oct · 08:18</div></div><div className="serif text-[30px] text-[#efb2a6]">$7</div></div></Card>
          <Field label="Reason shown in the record" value={query} onChange={setQuery} placeholder="code already used" />
          <PrimaryButton tone="coral" onClick={() => setState('waiting')} disabled={!query.trim()} className="w-full"><XCircle size={14} />Decline and record reason</PrimaryButton>
          <AlertBox>Declining is reversible from the confirmed history. It does not delete the reference.</AlertBox>
        </div>
      )}

      {state === 'search' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={Search}>find a reference</SectionLabel>
          <Field label="Reference code" value={query} onChange={setQuery} placeholder="H8TF7-AFJYL" />
          <PrimaryButton tone="coral" onClick={() => setResult(query || 'H8TF7-AFJYL')} disabled={!query.trim()} className="w-full"><Search size={14} />Find payment</PrimaryButton>
          {result && <Card tone="sage"><div className="flex items-center justify-between"><div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">{result}</div><div className="mt-2 text-[10px] text-[#9bb7a7]">Wise · confirmed 16 Oct · 08:43</div></div><StatusPill tone="sage">confirmed</StatusPill></div><div className="mt-3 flex items-center justify-between border-t border-[#385848] pt-3"><span className="text-[10px] text-[#8fae9d]">session value</span><span className="serif text-[24px] text-[#b9dec9]">$7</span></div></Card>}
        </div>
      )}

      {state === 'confirmed' && (
        <div className="fade-in space-y-3">
          <SectionLabel icon={CheckCircle2}>confirmed so far</SectionLabel>
          <AlertBox tone="sage">Payment confirmed. The reference can now be matched to a call.</AlertBox>
          <Card tone="sage"><div className="flex items-center justify-between"><div><div className="mono text-[10px] font-bold tracking-[0.08em] text-[#e0c18c]">H8TF7-AFJYL</div><div className="mt-2 text-[10px] text-[#9bb7a7]">Wise · confirmed just now</div></div><div className="serif text-[28px] text-[#b9dec9]">$7</div></div></Card>
          <div className="border-t border-[#2a3a36] pt-4"><SectionLabel icon={ClipboardCheck}>history</SectionLabel><div className="space-y-2">{['M6DA2-KC8TU · Wise · confirmed yesterday', 'P4NV1-JF3QX · Gift card · confirmed 12 Oct', 'J9RS5-VB2LD · Wise · declined 10 Oct'].map((line) => <div key={line} className="rounded-xl border border-[#344640] bg-[#1d2523] px-3 py-2.5 text-[10px] text-[#9fb5ab]">{line}</div>)}</div></div>
        </div>
      )}
    </PhoneShell>
  );
}
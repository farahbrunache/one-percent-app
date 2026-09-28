import { useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  FileText,
  LockKeyhole,
  MessageCircle,
  Mic,
  MoreHorizontal,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  Zap,
} from 'lucide-react';

type ChatMessage = {
  id: string;
  speaker: 'operator' | 'person' | 'system';
  text: string;
  time: string;
};

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    speaker: 'operator',
    text: 'You do not have to arrive with the right words. We can start with a conversation and work out what kind of help would actually be useful.',
    time: '09:41',
  },
  {
    id: 'options',
    speaker: 'operator',
    text: 'There are two ways to begin: speak your thoughts out loud with a $7 AI intake call, or ask for a chat quote and keep the conversation here.',
    time: '09:42',
  },
  {
    id: 'person',
    speaker: 'person',
    text: 'I think I can explain it better if I can write a little first.',
    time: '09:44',
  },
  {
    id: 'quote',
    speaker: 'operator',
    text: 'That makes sense. I can quote the chat based on what you need from the conversation, rather than putting you into a public tier.',
    time: '09:44',
  },
];

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.speaker === 'system') {
    return (
      <div className="my-3 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[#71857d]">
        <span className="h-px w-7 bg-[#2d3e3a]" />
        {message.text}
        <span className="h-px w-7 bg-[#2d3e3a]" />
      </div>
    );
  }

  const isPerson = message.speaker === 'person';
  return (
    <div className={`flex items-end gap-2 ${isPerson ? 'justify-end' : 'justify-start'}`}>
      {!isPerson && (
        <div className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#304d45] text-[#b9dacb]">
          <Sparkles size={13} />
        </div>
      )}
      <div className={`max-w-[82%] ${isPerson ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-[18px] px-3.5 py-3 text-[12px] leading-[1.55] ${isPerson ? 'rounded-br-md bg-[#b86b5d] text-[#fff0e8]' : 'rounded-bl-md border border-[#334a43] bg-[#202d2a] text-[#c9d8d1]'}`}>
          {message.text}
        </div>
        <span className="mt-1 px-1 text-[9px] text-[#647a72]">{message.time}</span>
      </div>
      {isPerson && (
        <div className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#3a3029] text-[#e5b98a]">
          <UserRound size={13} />
        </div>
      )}
    </div>
  );
}

export function ClientChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [mode, setMode] = useState<'undecided' | 'chat' | 'call'>('undecided');
  const [chatPaid, setChatPaid] = useState(false);
  const [callPaid, setCallPaid] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2300);
  };

  const chooseChat = () => {
    setMode('chat');
    setQuoteOpen(true);
    showToast('Chat quote is ready to review');
  };

  const payChat = () => {
    setMode('chat');
    setChatPaid(true);
    setQuoteOpen(false);
    setMessages((current) => [
      ...current,
      { id: `paid-${Date.now()}`, speaker: 'system', text: 'Chat session paid · 8 message turns available', time: 'now' },
      { id: `paid-copy-${Date.now()}`, speaker: 'operator', text: 'You are in. Take the space you need. I will keep the scope we agreed on visible as we go.', time: 'now' },
    ]);
    showToast('Chat session unlocked');
  };

  const payCall = () => {
    setMode('call');
    setCallPaid(true);
    setMessages((current) => [
      ...current,
      { id: `call-${Date.now()}`, speaker: 'system', text: 'AI intake call paid · ready when you are', time: 'now' },
    ]);
    showToast('AI intake call unlocked');
  };

  const sendMessage = () => {
    if (!chatPaid || !draft.trim()) return;
    setMessages((current) => [
      ...current,
      { id: `person-${Date.now()}`, speaker: 'person', text: draft.trim(), time: 'now' },
    ]);
    setDraft('');
    showToast('Message added to your chat session');
  };

  return (
    <div className="client-chat min-h-[100dvh] overflow-x-hidden bg-[#0d1110] text-[#e6eee9]">
      <style>{`
        .client-chat { font-family:'DM Sans','Avenir Next',sans-serif; }
        .client-chat * { box-sizing:border-box; }
        .client-chat .serif { font-family:Georgia,'Times New Roman',serif; }
        .client-chat .mono { font-family:'IBM Plex Mono','SFMono-Regular',monospace; }
        .client-chat ::selection { background:#d09668; color:#171b1a; }
        .client-chat textarea:focus { outline:2px solid rgba(201,104,89,.7); outline-offset:1px; }
        .client-chat .chat-scroll::-webkit-scrollbar { width:5px; }
        .client-chat .chat-scroll::-webkit-scrollbar-thumb { background:#354a44; border-radius:8px; }
        .client-chat .fade-in { animation:clientChatFade .3s ease-out both; }
        @keyframes clientChatFade { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div className="min-h-[100dvh] bg-[#0d1110] md:px-6 md:py-6">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col overflow-hidden border-x border-[#2b3a37] bg-[#151918] shadow-[0_20px_70px_rgba(0,0,0,.4)] md:min-h-[980px] md:rounded-[28px] md:border md:shadow-[0_24px_90px_rgba(0,0,0,.5)]">
          <header className="shrink-0 border-b border-[#2a3a36] bg-[#171d1c] px-4 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ddb077] text-[#17201e]">
                  <MessageCircle size={18} strokeWidth={2.4} />
                </div>
                <div>
                  <div className="serif text-[18px] font-semibold tracking-[-0.03em] text-[#f4eadb]">fieldwork</div>
                  <div className="mono text-[8px] uppercase tracking-[0.18em] text-[#829991]">private conversation</div>
                </div>
              </div>
              <button onClick={() => showToast('Conversation details opened')} className="rounded-xl border border-[#33443f] bg-[#202927] p-2 text-[#91aaa0] hover:text-[#ddb077]" title="Conversation details">
                <MoreHorizontal size={17} />
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-[#2e4940] bg-[#1b2925] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#85c39e]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a8cabc]">Ari is reviewing this thread</span>
              </div>
              <span className="text-[9px] text-[#789087]">usually replies today</span>
            </div>
          </header>

          <main className="chat-scroll min-h-0 flex-1 overflow-y-auto bg-[#151918] px-4 py-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#7c9289]">Your conversation</div>
                <div className="mt-1 text-[10px] text-[#60756e]">Nothing is billed until you choose a path.</div>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-[#71857d]"><LockKeyhole size={11} /> private</div>
            </div>

            <div className="space-y-3">
              {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            </div>

            {!chatPaid && !callPaid && (
              <div className="fade-in mt-5 space-y-3">
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.13em] text-[#7f958d]">
                  <Zap size={12} className="text-[#d0a26d]" />
                  Choose how to begin
                </div>

                <button onClick={payCall} className={`w-full rounded-2xl border p-4 text-left transition ${mode === 'call' ? 'border-[#cb7567] bg-[#352624]' : 'border-[#61463c] bg-[#2a2420] hover:border-[#bd796b]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#49302c] text-[#e9a296]"><Mic size={17} /></div>
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[12px] font-bold text-[#f0d5c9]">AI intake call</span>
                          <span className="rounded-full border border-[#85504a] bg-[#452d2a] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#e6a094]">$7 fixed</span>
                        </div>
                        <p className="text-[10px] leading-[1.45] text-[#b99b8e]">Use speech when talking is easier than writing. This is an intake call, separate from any later operator chat.</p>
                      </div>
                    </div>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-[#d48677]" />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-[#513936] pt-2.5 text-[9px] text-[#a58b81]">
                    <span className="flex items-center gap-1.5"><Clock3 size={11} /> about 15 minutes</span>
                    <span className="font-bold text-[#e29a8d]">Pay $7 · start call</span>
                  </div>
                </button>

                <button onClick={chooseChat} className={`w-full rounded-2xl border p-4 text-left transition ${mode === 'chat' ? 'border-[#58866f] bg-[#21362d]' : 'border-[#365248] bg-[#1d2b27] hover:border-[#6a9881]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2b4a3d] text-[#a8d6bc]"><MessageCircle size={17} /></div>
                      <div>
                        <div className="text-[12px] font-bold text-[#d5e7dd]">Continue by chat</div>
                        <p className="mt-1 text-[10px] leading-[1.45] text-[#94b1a3]">Ask for a quote in this conversation. The operator will price the session around the value and scope of the help you need.</p>
                      </div>
                    </div>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-[#8ec1a5]" />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-[#304d41] pt-2.5 text-[9px] text-[#849f92]">
                    <span className="flex items-center gap-1.5"><UserRound size={11} /> operator-set quote</span>
                    <span className="font-bold text-[#a8d4b9]">Ask for chat quote</span>
                  </div>
                </button>
              </div>
            )}

            {mode === 'chat' && !chatPaid && !callPaid && (
              <div className="fade-in mt-4 rounded-2xl border border-[#3b5548] bg-[#202f2a] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#9bc5ad]"><FileText size={13} /> chat quote</div>
                    <h2 className="mt-1 text-[14px] font-bold text-[#e0eee6]">Ari quoted this conversation at $18</h2>
                  </div>
                  <button onClick={() => setQuoteOpen(!quoteOpen)} className="rounded-lg p-1 text-[#8fb4a2] hover:bg-[#2a4037]" title="Toggle quote details">{quoteOpen ? <ChevronDown size={15} /> : <ArrowRight size={15} />}</button>
                </div>
                {quoteOpen && (
                  <div className="space-y-2 border-t border-[#385448] pt-3 text-[10px] text-[#9fbcaf]">
                    <div className="flex items-center justify-between"><span>Scope</span><span className="font-semibold text-[#d0e2d8]">One focused chat session</span></div>
                    <div className="flex items-center justify-between"><span>Included</span><span className="font-semibold text-[#d0e2d8]">8 message turns · 7 days</span></div>
                    <div className="flex items-center justify-between"><span>Rate logic</span><span className="font-semibold text-[#d0e2d8]">Quoted for this conversation</span></div>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={payChat} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#498469] py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[#eff9f1] hover:bg-[#599a7a]"><CreditCard size={13} />Pay $18 · unlock chat</button>
                  <button onClick={() => showToast('Question sent before payment')} className="rounded-xl border border-[#4b6757] px-3 py-2.5 text-[10px] font-bold text-[#a6cdb7] hover:bg-[#2b4036]">Ask first</button>
                </div>
                <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] text-[#718c80]"><ShieldCheck size={11} /> Secure invoice · no recurring charge</div>
              </div>
            )}

            {callPaid && (
              <div className="fade-in mt-4 rounded-2xl border border-[#60443a] bg-[#2b2420] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#49302c] text-[#e9a296]"><PhoneCall size={16} /></div>
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.11em] text-[#e8a095]"><CheckCircle2 size={12} /> AI intake call ready</div>
                    <p className="mt-1 text-[11px] leading-[1.45] text-[#c4a59a]">Use the call to get the thoughts out. This does not start a paid operator chat session; that can be quoted separately afterward.</p>
                  </div>
                </div>
                <button onClick={() => showToast('Opening the AI intake call')} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#80534b] bg-[#3b2b27] py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#edb0a4] hover:bg-[#49312c]"><Mic size={13} />Join AI intake call</button>
              </div>
            )}

            {chatPaid && (
              <div className="fade-in mt-4 rounded-2xl border border-[#385b4a] bg-[#1d3028] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-[#b4d6c2]"><CheckCircle2 size={13} /> Paid chat session</div>
                  <button onClick={() => showToast('Invoice details opened')} className="flex items-center gap-1 text-[9px] font-bold text-[#8fc0a3]"><FileText size={11} />View invoice</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-[#87a999]">
                  <span className="rounded-full bg-[#294438] px-2 py-1">8 turns included</span>
                  <span className="rounded-full bg-[#294438] px-2 py-1">7 days to reply</span>
                  <span className="rounded-full bg-[#294438] px-2 py-1">no recurring charge</span>
                </div>
              </div>
            )}
          </main>

          <footer className="shrink-0 border-t border-[#2a3a36] bg-[#171d1c] p-3">
            {chatPaid ? (
              <div className="flex items-end gap-2">
                <div className="flex-1 rounded-2xl border border-[#384d45] bg-[#202c29] px-3 py-2">
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} rows={2} placeholder="Write what is on your mind…" className="w-full resize-none bg-transparent text-[12px] leading-[1.45] text-[#d6e5dd] placeholder:text-[#71877f]" />
                  <div className="mt-1 flex items-center justify-between border-t border-[#30413c] pt-1.5"><span className="text-[9px] text-[#71867e]">Shift + Enter for a new line</span><span className="flex items-center gap-1 text-[9px] text-[#789c8b]"><LockKeyhole size={10} />paid session</span></div>
                </div>
                <button onClick={sendMessage} disabled={!draft.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#c96859] text-[#fff0e5] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#d77b6b]" title="Send message"><Send size={16} /></button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[#394943] bg-[#1b2422] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[10px] text-[#81968d]"><LockKeyhole size={13} className="text-[#d0a26d]" /><span>Choose a path above to continue</span></div>
                <button onClick={() => showToast('You can ask a question before paying')} className="shrink-0 text-[9px] font-bold text-[#d1a06e] hover:text-[#efbc84]">Ask a question</button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-center gap-1 text-[9px] text-[#60756e]"><ShieldCheck size={11} /> Payment is processed securely · no recurring plans</div>
          </footer>
        </div>
      </div>

      {toast && <div className="fade-in fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#466e5e] bg-[#1c3b32] px-4 py-2.5 text-[11px] font-semibold text-[#e5f0e8] shadow-xl"><Check size={14} className="text-[#b8d795]" />{toast}</div>}
    </div>
  );
}
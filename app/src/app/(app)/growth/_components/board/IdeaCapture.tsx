// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/board/IdeaCapture`
 * Purpose: The board's intake affordance at the head of the Opportunities column —
 *   speak or type an idea, then generate a batch of drafts steered by it. This is the
 *   reworked entry point: the owner's voice note (via the existing Web Speech
 *   dictation adapter) or a typed note becomes the `seed` that leads the GENERATE
 *   pass, ahead of ranked priorities and raw research.
 * Scope: Client component. Owns the capture text + mic session + generate busy state;
 *   refreshes via `router.refresh()` so the new drafts appear in the Drafts column.
 * Invariants:
 *   - PROGRESSIVE_ENHANCEMENT: the mic renders only when SpeechRecognition exists;
 *     typing always works. A bodyless/empty capture still generates off strategy.
 *   - NOT_A_TRIGGER_TO_PUBLISH: Generate only fills the Drafts queue — nothing here
 *     posts (mirrors the hub rule: research/ideas are intelligence, not auto-posting).
 * Side-effects: browser (microphone) + IO (POST .../generate via the mutate wrapper).
 * Links: ../../_api/mutateCampaign.ts (generatePosts),
 *   @/features/ai/chat/adapters/web-speech-dictation.adapter
 * @internal
 */

"use client";

import type { DictationAdapter } from "@assistant-ui/react";
import { Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { Button } from "@/components";
import {
  createWebSpeechDictationAdapter,
  isSpeechRecognitionSupported,
} from "@/features/ai/chat/adapters/web-speech-dictation.adapter";

import { generatePosts } from "../../_api/mutateCampaign";

export function IdeaCapture({
  campaignId,
}: {
  campaignId: string;
}): ReactElement {
  const router = useRouter();
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<DictationAdapter.Session | null>(null);

  const micSupported = isSpeechRecognitionSupported();

  // Stop any live mic session if the component unmounts mid-listen.
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
    };
  }, []);

  const startListening = () => {
    const adapter = createWebSpeechDictationAdapter();
    if (!adapter) return;
    setError(null);
    setNote(null);
    const session = adapter.listen();
    sessionRef.current = session;
    setListening(true);
    // Interim results preview live; finals commit into the textarea.
    session.onSpeech((result) => {
      if (!result.isFinal) setInterim(result.transcript);
    });
    session.onSpeechEnd((result) => {
      setInterim("");
      setText((prev) =>
        `${prev} ${result.transcript}`.replace(/\s+/g, " ").trimStart()
      );
    });
  };

  const stopListening = () => {
    void sessionRef.current?.stop();
    sessionRef.current = null;
    setInterim("");
    setListening(false);
  };

  const toggleMic = () => (listening ? stopListening() : startListening());

  const generate = async () => {
    if (listening) stopListening();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const seed = text.trim();
      const count = await generatePosts(campaignId, seed || undefined);
      setText("");
      setNote(
        count > 0
          ? `Generated ${count} draft${count === 1 ? "" : "s"} → Drafts`
          : "Generate ran — no drafts produced."
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-lg border border-border bg-background p-2">
        <textarea
          aria-label="Capture an idea to generate drafts from"
          placeholder={
            micSupported
              ? "Speak or type an idea to generate from…"
              : "Type an idea to generate from…"
          }
          className="min-h-14 w-full resize-y bg-transparent text-sm leading-snug outline-none placeholder:text-muted-foreground"
          value={listening && interim ? `${text} ${interim}`.trimStart() : text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <div className="flex items-center gap-1.5 pt-1">
          {micSupported && (
            <Button
              type="button"
              size="sm"
              variant={listening ? "default" : "outline"}
              className={cn("h-7 gap-1 px-2 text-xs", listening && "animate-pulse")}
              disabled={busy}
              onClick={toggleMic}
              aria-pressed={listening}
            >
              {listening ? (
                <>
                  <MicOff className="size-3.5" aria-hidden="true" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="size-3.5" aria-hidden="true" />
                  Speak
                </>
              )}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="ml-auto h-7 gap-1 px-2.5 text-xs"
            disabled={busy}
            onClick={generate}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {busy ? "Generating…" : text.trim() ? "Generate from idea" : "Generate"}
          </Button>
        </div>
      </div>
      {note && !error && (
        <p className="px-1 text-muted-foreground text-xs" role="status">
          {note}
        </p>
      )}
      {error && (
        <p
          className="rounded-md bg-destructive/10 px-2 py-1 text-destructive text-xs"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

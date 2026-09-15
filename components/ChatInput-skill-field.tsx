"use client";

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { parsePromptSegments, skillToken } from "@/lib/skill-tokens";

export type PromptFieldHandle = {
  focus: () => void;
  getCaret: () => number;
  setCaret: (offset: number) => void;
  getElement: () => HTMLElement | null;
  adjustHeight: () => void;
};

function makeChip(name: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "composer-inline-skill";
  chip.contentEditable = "false";
  chip.dataset.skill = name;
  chip.textContent = name;
  return chip;
}

function serializeField(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.skill) {
      out += skillToken(el.dataset.skill);
      return;
    }
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    if (el.tagName === "DIV" && el !== root) {
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  return out;
}

function renderField(root: HTMLElement, text: string): void {
  root.replaceChildren();
  const segments = parsePromptSegments(text);
  if (segments.length === 0) return;
  for (const segment of segments) {
    if (segment.type === "text") {
      const parts = segment.value.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) root.append(document.createElement("br"));
        if (part) root.append(document.createTextNode(part));
      });
    } else {
      root.append(makeChip(segment.name));
    }
  }
}

function caretSerializedOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return serializeField(root).length;
  }
  const range = selection.getRangeAt(0);
  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  const holder = document.createElement("div");
  holder.append(probe.cloneContents());
  return serializeField(holder).length;
}

function setCaretSerializedOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  let remaining = Math.max(0, offset);
  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= text.length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    if (el.dataset.skill) {
      const tokenLength = skillToken(el.dataset.skill).length;
      if (remaining <= tokenLength) {
        const range = document.createRange();
        range.setStartAfter(el);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= tokenLength;
      return false;
    }
    if (el.tagName === "BR") {
      if (remaining <= 1) {
        const range = document.createRange();
        range.setStartAfter(el);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of Array.from(el.childNodes)) {
      if (place(child)) return true;
    }
    return false;
  };
  if (!place(root)) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export const ComposerSkillField = forwardRef<PromptFieldHandle, {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  onCaret: (value: string, caret: number) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: React.CompositionEvent<HTMLElement>) => void;
}>(function ComposerSkillField({
  value,
  placeholder,
  disabled,
  onChange,
  onKeyDown,
  onPaste,
  onCaret,
  onCompositionStart,
  onCompositionEnd,
}, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const emittedRef = useRef(value);
  const composingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus() {
      elRef.current?.focus();
    },
    getCaret() {
      return elRef.current ? caretSerializedOffset(elRef.current) : emittedRef.current.length;
    },
    setCaret(offset: number) {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      setCaretSerializedOffset(el, offset);
    },
    getElement() {
      return elRef.current;
    },
    adjustHeight() {
      const el = elRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
  }), []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (value === emittedRef.current && el.childNodes.length > 0) return;
    if (value === emittedRef.current && value === "" && el.childNodes.length === 0) return;
    const caret = document.activeElement === el ? caretSerializedOffset(el) : value.length;
    renderField(el, value);
    emittedRef.current = value;
    if (document.activeElement === el) setCaretSerializedOffset(el, caret);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div
      ref={elRef}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      contentEditable={disabled ? false : true}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-empty={value.trim().length === 0 ? "true" : "false"}
      className="composer-skill-field"
      onInput={() => {
        const el = elRef.current;
        if (!el || composingRef.current) return;
        const next = serializeField(el);
        emittedRef.current = next;
        onChange(next);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onKeyUp={() => {
        const el = elRef.current;
        if (!el) return;
        onCaret(emittedRef.current, caretSerializedOffset(el));
      }}
      onMouseUp={() => {
        const el = elRef.current;
        if (!el) return;
        onCaret(emittedRef.current, caretSerializedOffset(el));
      }}
      onCompositionStart={() => {
        composingRef.current = true;
        onCompositionStart();
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const el = elRef.current;
        if (el) {
          const next = serializeField(el);
          emittedRef.current = next;
          onChange(next);
        }
        onCompositionEnd(event);
      }}
    />
  );
});

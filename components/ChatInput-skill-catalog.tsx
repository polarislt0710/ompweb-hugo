"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Code, Coffee, Palette, Search } from "lucide-react";
import {
  skillsInCategory,
  type CatalogSkill,
  type SkillCategoryId,
} from "@/lib/skill-catalog";
import type { SkillUsageMap } from "@/lib/skill-usage";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const CATEGORY_META: Array<{
  id: SkillCategoryId;
  labelKey: string;
  titleKey: string;
  Icon: typeof Code;
}> = [
  { id: "dev", labelKey: "chatInput.skillCatDev", titleKey: "chatInput.skillCatDevTitle", Icon: Code },
  { id: "design", labelKey: "chatInput.skillCatDesign", titleKey: "chatInput.skillCatDesignTitle", Icon: Palette },
  { id: "daily", labelKey: "chatInput.skillCatDaily", titleKey: "chatInput.skillCatDailyTitle", Icon: Coffee },
];

function skillByName(skills: readonly CatalogSkill[], name: string): CatalogSkill | undefined {
  const key = name.toLowerCase();
  return skills.find((skill) => skill.name.toLowerCase() === key);
}

export function SkillCategoryBar({
  skills,
  pinnedNames,
  usage,
  isStreaming,
  onPickSkill,
  t,
}: {
  skills: readonly CatalogSkill[];
  pinnedNames: readonly string[];
  usage: SkillUsageMap;
  isStreaming: boolean;
  onPickSkill: (skill: CatalogSkill) => void;
  t: Translate;
}) {
  const [openCategory, setOpenCategory] = useState<SkillCategoryId | null>(null);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isStreaming) setOpenCategory(null);
  }, [isStreaming]);

  useEffect(() => {
    if (!openCategory) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [openCategory]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpenCategory(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pinnedSet = useMemo(
    () => new Set(pinnedNames.map((name) => name.toLowerCase())),
    [pinnedNames],
  );

  const visibleSkills = useMemo(() => {
    if (!openCategory) return [];
    const list = skillsInCategory(skills, openCategory, usage);
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((skill) => {
      return skill.name.toLowerCase().includes(needle)
        || skill.description.toLowerCase().includes(needle);
    });
  }, [openCategory, query, skills, usage]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
      {CATEGORY_META.map(({ id, labelKey, titleKey, Icon }) => {
        const active = openCategory === id;
        const count = skillsInCategory(skills, id, usage).length;
        return (
          <button
            key={id}
            type="button"
            className="composer-plan-toggle"
            data-active={active ? "true" : "false"}
            onClick={() => { if (!isStreaming) setOpenCategory((current) => (current === id ? null : id)); }}
            disabled={isStreaming}
            aria-pressed={active}
            aria-expanded={active}
            aria-haspopup="dialog"
            title={t(titleKey)}
            aria-label={t(labelKey)}
          >
            <Icon size={11} strokeWidth={2} aria-hidden="true" />
            {t(labelKey)}
            <span className="composer-skill-cat-count">{count}</span>
          </button>
        );
      })}
      {openCategory && (
        <div
          className="picker-panel"
          role="dialog"
          aria-label={t(CATEGORY_META.find((item) => item.id === openCategory)?.titleKey ?? "chatInput.skillCatDevTitle")}
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 120,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <div className="picker-panel-header">
            <span className="picker-panel-title">
              {t(CATEGORY_META.find((item) => item.id === openCategory)?.titleKey ?? "chatInput.skillCatDevTitle")}
            </span>
            <span className="picker-panel-count">{visibleSkills.length}</span>
          </div>
          <label className="picker-search" style={{ marginBottom: 0 }}>
            <Search size={12} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("chatInput.skillCatalogSearch")}
              aria-label={t("chatInput.skillCatalogSearch")}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                color: "var(--text)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </label>
          <div className="composer-skill-list">
            {visibleSkills.length === 0 ? (
              <div className="composer-skill-list-empty">
                {t("chatInput.skillCatalogEmpty")}
              </div>
            ) : visibleSkills.map((skill) => {
              const pinned = pinnedSet.has(skill.name.toLowerCase());
              return (
                <button
                  key={skill.name}
                  type="button"
                  className="composer-skill-list-item"
                  data-active={pinned ? "true" : "false"}
                  title={skill.description || skill.name}
                  onClick={() => {
                    onPickSkill(skill);
                    setOpenCategory(null);
                  }}
                >
                  <span className="composer-skill-list-name">{skill.name}</span>
                  {skill.description ? (
                    <span className="composer-skill-list-desc">{skill.description}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="picker-panel-footer">
            <span>{t("chatInput.skillCatalogInsertHint")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SkillSuggestionRow({
  skills,
  pinnedNames,
  suggestions,
  armedName,
  isStreaming,
  onTogglePinned,
  onSuggestionClick,
  t,
}: {
  skills: readonly CatalogSkill[];
  pinnedNames: readonly string[];
  suggestions: readonly CatalogSkill[];
  armedName: string | null;
  isStreaming: boolean;
  onTogglePinned: (skill: CatalogSkill) => void;
  onSuggestionClick: (skill: CatalogSkill) => void;
  t: Translate;
}) {
  const pinnedSkills = pinnedNames
    .map((name) => skillByName(skills, name))
    .filter((skill): skill is CatalogSkill => Boolean(skill));
  if (pinnedSkills.length === 0 && suggestions.length === 0) return null;

  return (
    <div
      className="composer-skill-suggest-row"
      data-suggested={suggestions.length > 0 ? "true" : "false"}
      aria-live="polite"
    >
      <span className="composer-skill-suggest-label">
        {suggestions.length > 0 ? t("chatInput.useActiveSkills") : t("chatInput.skillPinnedLabel")}
      </span>
      {pinnedSkills.map((skill) => (
        <button
          key={`pinned:${skill.name}`}
          type="button"
          className="composer-skill-chip"
          data-state="pinned"
          disabled={isStreaming}
          title={t("chatInput.skillPinnedTitle", { name: skill.name })}
          aria-pressed="true"
          onClick={() => { if (!isStreaming) onTogglePinned(skill); }}
        >
          {skill.name}
        </button>
      ))}
      {suggestions.map((skill) => {
        const armed = armedName?.toLowerCase() === skill.name.toLowerCase();
        return (
          <button
            key={`suggest:${skill.name}`}
            type="button"
            className="composer-skill-chip"
            data-state={armed ? "armed" : "suggested"}
            disabled={isStreaming}
            title={t("chatInput.skillSuggestTitle", { name: skill.name })}
            aria-pressed={armed}
            onClick={() => { if (!isStreaming) onSuggestionClick(skill); }}
          >
            {skill.name}
          </button>
        );
      })}
    </div>
  );
}

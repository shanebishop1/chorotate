import { useEffect, useId, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function CustomDropdown({
  id: providedId,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: readonly DropdownOption[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const generatedId = useId().replaceAll(":", "");
  const id = providedId ?? `dropdown-${generatedId}`;
  const buttonId = `${id}-button`;
  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex] ?? options[0];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    selectedIndex >= 0 ? selectedIndex : firstEnabled(options),
  );
  const [placement, setPlacement] = useState<DropdownPlacement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (open && placement) listboxRef.current?.focus();
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      const listbox = listboxRef.current;
      if (!button || !listbox) return;
      const gap = 5;
      const inset = 8;
      const rect = button.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.width, 180),
        window.innerWidth - inset * 2,
      );
      const left = Math.min(
        Math.max(inset, rect.left),
        window.innerWidth - width - inset,
      );
      const below = window.innerHeight - rect.bottom - gap - inset;
      const above = rect.top - gap - inset;
      const opensUp = below < 160 && above > below;
      const available = Math.max(96, opensUp ? above : below);
      const maxHeight = Math.min(280, available);
      const naturalHeight = Math.min(listbox.scrollHeight, maxHeight);
      setPlacement({
        left,
        width,
        maxHeight,
        top: opensUp
          ? Math.max(inset, rect.top - gap - naturalHeight)
          : rect.bottom + gap,
      });
      requestAnimationFrame(() => listbox.focus());
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  function openDropdown(initialIndex = selectedIndex) {
    if (disabled) return;
    setActiveIndex(
      initialIndex >= 0 && !options[initialIndex]?.disabled
        ? initialIndex
        : firstEnabled(options),
    );
    setPlacement(undefined);
    setOpen(true);
  }

  function closeAndFocus() {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function moveActive(direction: 1 | -1) {
    if (options.length === 0) return;
    let index = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index]?.disabled) {
        setActiveIndex(index);
        document
          .getElementById(`${id}-option-${index}`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }

  function boundaryActive(atEnd: boolean) {
    const indexes = options.map((_, index) => index);
    if (atEnd) indexes.reverse();
    const index = indexes.find((candidate) => !options[candidate]?.disabled);
    if (index !== undefined) setActiveIndex(index);
  }

  return (
    <div className="custom-dropdown" ref={rootRef}>
      <span className="custom-dropdown-label" id={labelId}>
        {label}
      </span>
      <button
        ref={buttonRef}
        id={buttonId}
        className="custom-dropdown-trigger"
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${selected?.label ?? "No options"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            if (!open) openDropdown();
          }
        }}
      >
        <span>{selected?.label ?? "No options"}</span>
        <svg viewBox="0 0 12 8" aria-hidden="true" focusable="false">
          <path d="m1.5 1.5 4.5 4 4.5-4" />
        </svg>
      </button>
      {open ? (
        <div
          ref={listboxRef}
          id={listboxId}
          className="custom-dropdown-listbox"
          role="listbox"
          tabIndex={-1}
          aria-label={`${label} options`}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          style={
            placement
              ? {
                  top: placement.top,
                  left: placement.left,
                  width: placement.width,
                  maxHeight: placement.maxHeight,
                }
              : { visibility: "hidden" }
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              boundaryActive(event.key === "End");
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(activeIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeAndFocus();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {options.map((option, index) => (
            <div
              key={`${option.value}:${index}`}
              id={`${id}-option-${index}`}
              className={index === activeIndex ? "is-active" : undefined}
              role="option"
              data-value={option.value}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              onPointerMove={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              <span className="custom-dropdown-check" aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function firstEnabled(options: readonly DropdownOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

/**
 * ViscosityCode: small building blocks shared by the Settings → Effects groups,
 * matching the existing settings patterns (Audio's titled groups, Appearance's
 * single-thumb HeroUI slider).
 */
import type { ReactNode } from "react";
import { Slider, SliderFill, SliderOutput, SliderThumb, SliderTrack } from "@heroui/react";

/** A titled block of rows; `disabled` dims the rows a master switch has turned off. */
export function EffectsSettingsGroup(props: {
  title: string;
  description: string;
  disabled?: boolean;
  /** Rows that stay fully visible above the dimmed ones (the master switch). */
  lead?: ReactNode;
  /** Makes the whole group a settings-search target (its rows have no anchors of their own). */
  anchorId?: string;
  children: ReactNode;
}) {
  return (
    <section
      {...(props.anchorId ? { id: props.anchorId, "data-settings-anchor": props.anchorId } : {})}
      className={`space-y-4 ${props.anchorId ? "scroll-mt-4" : ""}`}
      aria-label={props.title}
    >
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
        <p className="mt-1 text-xs text-muted">{props.description}</p>
      </div>
      {props.lead}
      <div className={`space-y-4 transition-opacity ${props.disabled ? "opacity-40" : ""}`}>
        {props.children}
      </div>
    </section>
  );
}

/** Single-thumb integer slider with its value shown above the track. */
export function EffectsSlider(props: {
  "aria-label": string;
  value: number;
  minValue: number;
  maxValue: number;
  step: number;
  isDisabled: boolean;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  /** Width override; defaults to the settings-row width. */
  className?: string;
}) {
  return (
    <Slider
      aria-label={props["aria-label"]}
      className={`${props.className ?? "w-[220px]"} shrink-0`}
      minValue={props.minValue}
      maxValue={props.maxValue}
      step={props.step}
      value={props.value}
      isDisabled={props.isDisabled}
      onChange={(next) => {
        // HeroUI's Slider emits number | number[]; this control is single-thumb.
        const value = Array.isArray(next) ? next[0] : next;
        if (typeof value === "number" && value !== props.value) props.onChange(value);
      }}
    >
      <div className="mb-1.5 flex items-center justify-end">
        <SliderOutput className="text-xs tabular-nums text-muted">
          {(values) => props.formatValue(values.state.getThumbValue(0))}
        </SliderOutput>
      </div>
      <SliderTrack>
        <SliderFill />
        <SliderThumb />
      </SliderTrack>
    </Slider>
  );
}

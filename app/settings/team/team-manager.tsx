"use client";

import { Plus, Power, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createStaffAction, saveStaffHoursAction, setServiceStaffAction, updateStaffAction } from "@/app/settings/actions";
import { FormField } from "@/components/patterns/form-field";
import { HoursEditor } from "@/components/patterns/hours-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { addWindow, hoursValid, removeWindow, setWindow, toggleDay, type DayHours } from "@/lib/lab/onboarding";
import type { TeamErrorCode, TeamPersonRow } from "@/modules/team/schema";

type Person = TeamPersonRow & { hours: DayHours[] };
type ServiceRef = { id: string; name: string; personIds: string[] };

export function TeamManager({ people, services }: { people: Person[]; services: ServiceRef[] }) {
  const t = useTranslations("settings.team");
  const active = people.filter((p) => p.active);
  const inactive = people.filter((p) => !p.active);
  return (
    <div className="grid gap-10">
      <section aria-labelledby="people-title" className="grid gap-4">
        <div>
          <h2 id="people-title" className="text-lg font-semibold">{t("people.title")}</h2>
          <p className="text-sm text-muted-foreground" data-testid="public-names-notice">{t("people.publicNotice")}</p>
        </div>
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="team-list">
          {active.map((p) => (
            <PersonRow key={p.id} person={p} onlyActive={active.length === 1} />
          ))}
        </ul>
        <AddPerson full={people.length >= 30} />
        {inactive.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t("people.inactiveTitle")}</h3>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="team-inactive">
              {inactive.map((p) => (
                <PersonRow key={p.id} person={p} onlyActive={false} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="hours-title" className="grid gap-4">
        <div>
          <h2 id="hours-title" className="text-lg font-semibold">{t("hours.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("hours.subtitle")}</p>
        </div>
        <div className="grid gap-3">
          {active.map((p) => (
            <PersonHours key={p.id} person={p} />
          ))}
        </div>
      </section>

      {services.length > 0 && active.length > 1 ? (
        <section aria-labelledby="services-title" className="grid gap-4">
          <div>
            <h2 id="services-title" className="text-lg font-semibold">{t("services.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("services.subtitle")}</p>
          </div>
          <div className="grid gap-3">
            {services.map((s) => (
              <ServiceRestriction key={`${s.id}:${s.personIds.join()}`} service={s} people={active} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function errorText(t: ReturnType<typeof useTranslations>, code: TeamErrorCode): string {
  const map: Partial<Record<TeamErrorCode, string>> = { LIMIT: "limit", NAME_TAKEN: "nameTaken", LAST_ACTIVE: "lastActive", FORBIDDEN: "forbidden", VALIDATION: "invalid" };
  return t(`errors.${map[code] ?? "generic"}`);
}

function AddPerson({ full }: { full: boolean }) {
  const t = useTranslations("settings.team");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    if (name.trim() === "") return setError(t("errors.nameRequired"));
    setError(null);
    start(async () => {
      const r = await createStaffAction(name);
      if (!r.ok) return setError(errorText(t, r.code));
      toast(t("people.added"), { variant: "success" });
      setName("");
      router.refresh();
    });
  };
  if (full) return <p className="text-sm text-muted-foreground" data-testid="team-full">{t("errors.limit")}</p>;
  return (
    <form
      method="post"
      noValidate
      aria-label={t("people.add")}
      className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label={t("people.nameLabel")} error={error ?? undefined}>
        {(a) => <Input {...a} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="new-person-name" />}
      </FormField>
      <Button type="submit" disabled={pending} data-testid="add-person">
        <Plus aria-hidden />
        {t("people.add")}
      </Button>
    </form>
  );
}

function PersonRow({ person, onlyActive }: { person: Person; onlyActive: boolean }) {
  const t = useTranslations("settings.team");
  const router = useRouter();
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const dirty = name.trim() !== person.name;
  const run = (change: { name?: string; active?: boolean }, done: string) =>
    start(async () => {
      setError(null);
      const r = await updateStaffAction({ id: person.id, ...change });
      if (!r.ok) return setError(errorText(t, r.code));
      setConfirming(false);
      toast(done, { variant: "success" });
      router.refresh();
    });
  return (
    <li className="grid gap-3 px-4 py-4" data-testid={`person-${person.name}`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField label={t("people.nameLabel")} error={error ?? undefined}>
          {(a) => <Input {...a} value={name} maxLength={80} disabled={!person.active} onChange={(e) => setName(e.target.value)} data-testid={`name-${person.id}`} />}
        </FormField>
        <div className="flex flex-wrap gap-2">
          {person.active ? (
            <>
              <Button variant="outline" disabled={pending || !dirty || name.trim() === ""} onClick={() => run({ name }, t("people.renamed"))} data-testid={`rename-${person.id}`}>
                {t("people.save")}
              </Button>
              <Button variant="outline" disabled={pending || onlyActive} onClick={() => setConfirming(true)} data-testid={`deactivate-${person.id}`}>
                <Power aria-hidden />
                {t("people.deactivate")}
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled={pending} onClick={() => run({ active: true }, t("people.reactivated"))} data-testid={`reactivate-${person.id}`}>
              <RotateCcw aria-hidden />
              {t("people.reactivate")}
            </Button>
          )}
        </div>
      </div>
      {onlyActive && person.active ? <p className="text-sm text-muted-foreground">{t("people.lastActiveHint")}</p> : null}
      {!person.active && person.futureAppointments > 0 ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid={`orphans-${person.id}`}>
          {t("people.orphans", { count: person.futureAppointments })}
        </p>
      ) : null}
      {confirming ? (
        <div role="alertdialog" aria-label={t("people.confirmTitle", { name: person.name })} className="grid gap-3 rounded-md border bg-muted/40 p-3" data-testid={`confirm-${person.id}`}>
          <p className="text-sm">
            {person.futureAppointments > 0 ? t("people.confirmWithAppointments", { name: person.name, count: person.futureAppointments }) : t("people.confirmNone", { name: person.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => run({ active: false }, t("people.deactivated"))} data-testid={`confirm-deactivate-${person.id}`}>
              {t("people.confirmYes")}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              {t("people.confirmNo")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function PersonHours({ person }: { person: Person }) {
  const t = useTranslations("settings.team.hours");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(person.hours);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const valid = hoursValid(hours);
  const dirty = JSON.stringify(hours) !== JSON.stringify(person.hours);
  const summary = person.hours.some((d) => d.open) ? t("set") : t("notSet");
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveStaffHoursAction(person.id, hours);
      if (!r.ok) return setError(r.code === "FORBIDDEN" ? t("forbidden") : t("invalid"));
      toast(t("saved"), { variant: "success" });
      router.refresh();
    });
  return (
    <div className="rounded-lg border bg-card" data-testid={`hours-${person.id}`}>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-start" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={`hours-toggle-${person.id}`}>
        <span className="font-semibold">{person.name}</span>
        <span className="text-sm text-muted-foreground">{summary}</span>
      </button>
      {open ? (
        <div className="grid gap-4 border-t p-4">
          <HoursEditor
            hours={hours}
            onToggle={(d) => setHours((h) => toggleDay(h, d))}
            onSet={(d, i, from, to) => setHours((h) => setWindow(h, d, i, from, to))}
            onAdd={(d) => setHours((h) => addWindow(h, d))}
            onRemove={(d, i) => setHours((h) => removeWindow(h, d, i))}
          />
          {!valid ? <p role="alert" className="text-sm font-medium text-destructive">{t("invalid")}</p> : null}
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
          <Button className="justify-self-start" disabled={pending || !valid || !dirty} onClick={save} data-testid={`save-hours-${person.id}`}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ServiceRestriction({ service, people }: { service: ServiceRef; people: Person[] }) {
  const t = useTranslations("settings.team.services");
  const router = useRouter();
  const [only, setOnly] = useState(service.personIds.length > 0);
  const [picked, setPicked] = useState<string[]>(service.personIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = only ? picked : [];
  const dirty = JSON.stringify([...chosen].sort()) !== JSON.stringify([...service.personIds].sort());
  const invalid = only && picked.length === 0;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await setServiceStaffAction({ serviceId: service.id, resourceIds: chosen });
      if (!r.ok) return setError(r.code === "FORBIDDEN" ? t("forbidden") : t("generic"));
      toast(t("saved"), { variant: "success" });
      router.refresh();
    });
  return (
    <fieldset className="grid gap-3 rounded-lg border bg-card p-4" data-testid={`restrict-${service.id}`}>
      <legend className="px-1 font-semibold">{service.name}</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="radio" className="size-4 accent-[var(--primary)]" name={`scope-${service.id}`} checked={!only} onChange={() => setOnly(false)} data-testid={`everyone-${service.id}`} />
        {t("everyone")}
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="radio" className="size-4 accent-[var(--primary)]" name={`scope-${service.id}`} checked={only} onChange={() => setOnly(true)} data-testid={`only-${service.id}`} />
        {t("only")}
      </label>
      {only ? (
        <div className="grid gap-1 ps-6">
          {people.map((p) => (
            <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={picked.includes(p.id)}
                onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                data-testid={`pick-${service.id}-${p.id}`}
              />
              {p.name}
            </label>
          ))}
        </div>
      ) : null}
      {invalid ? <p role="alert" className="text-sm font-medium text-destructive">{t("pickOne")}</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
      <Button className="justify-self-start" disabled={pending || invalid || !dirty} onClick={save} data-testid={`save-restrict-${service.id}`}>
        {t("save")}
      </Button>
    </fieldset>
  );
}

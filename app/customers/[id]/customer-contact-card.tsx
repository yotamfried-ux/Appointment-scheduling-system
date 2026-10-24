"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Edit2, Mail, MessageCircle, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import type { CustomerDuplicate } from "@/modules/customers/service";

interface CustomerContactCardProps {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  duplicates?: CustomerDuplicate[];
}

export function CustomerContactCard({ id, fullName, phone, email, duplicates = [] }: CustomerContactCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<CustomerDuplicate | null>(null);

  // Edit form state
  const [name, setName] = useState(fullName);
  const [phoneVal, setPhoneVal] = useState(phone);
  const [emailVal, setEmailVal] = useState(email ?? "");
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // WhatsApp international clean number (e.g. 972501234567)
  const waNumber = phone.replace(/[^0-9]/g, "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    if (name.trim().length < 2) nextErrors.name = "יש להזין שם (לפחות 2 תווים).";
    if (!phoneVal.trim()) nextErrors.phone = "יש להזין מספר טלפון.";
    if (emailVal.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal.trim())) {
      nextErrors.email = "כתובת האימייל אינה תקינה.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await ownerApi.updateCustomer(id, {
        fullName: name.trim(),
        phone: phoneVal.trim(),
        email: emailVal.trim() || null,
      });
      toast("פרטי הלקוח עודכנו בהצלחה", { variant: "success" });
      setEditOpen(false);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === "VALIDATION_FAILED" && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        const msg = err instanceof Error ? err.message : "שגיאה בעדכון פרטי הלקוח";
        toast(msg, { variant: "error" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleMerge() {
    if (!mergeTarget || merging) return;
    setMerging(true);
    try {
      // Merge source (duplicate) into this customer target (id)
      const res = await ownerApi.mergeCustomers(mergeTarget.id, id);
      toast(`הכרטיסים אוחדו בהצלחה (${res.appointmentsMoved} תורים הועברו)`, { variant: "success" });
      setMergeTarget(null);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "שגיאה באיחוד הלקוחות";
      toast(msg, { variant: "error" });
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="grid gap-3">
      {/* Duplicate Customer Merge Alert Banner */}
      {duplicates.length > 0 ? (
        <div className="rounded-lg border border-primary/30 bg-primary-soft p-4 text-sm text-primary-soft-foreground" data-testid="duplicate-customer-alert">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="size-4 shrink-0 text-primary" />
                <span>זוהה לקוח נוסף במערכת עם אותו מספר טלפון</span>
              </div>
              <p className="text-xs text-muted-foreground">
                נמצא כרטיס נוסף: <bdi className="font-medium text-foreground">{duplicates[0].fullName}</bdi>
                {duplicates[0].email ? ` (${duplicates[0].email})` : " (ללא אימייל)"}. באפשרותך לאחד את שני הכרטיסים לכרטיס אחד מסודר.
              </p>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => setMergeTarget(duplicates[0])}
              className="shrink-0 text-xs font-semibold"
              data-testid="merge-customer-btn"
            >
              <Users className="size-3.5 me-1" />
              איחוד כרטיסים
            </Button>
          </div>
        </div>
      ) : null}

      {/* Main Contact Card */}
      <div className="rounded-lg border bg-card p-4 text-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <span className="font-semibold text-muted-foreground text-xs">פרטי התקשרות</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setName(fullName);
              setPhoneVal(phone);
              setEmailVal(email ?? "");
              setErrors({});
              setEditOpen(true);
            }}
            className="h-8 gap-1.5 text-xs"
            data-testid="edit-customer-btn"
          >
            <Edit2 className="size-3" />
            עריכת פרטים
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Phone */}
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground block">מספר טלפון</span>
              <span className="font-semibold tabular-nums" dir="ltr" data-testid="customer-phone">{phone}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs" title="חיוג">
                <a href={`tel:${phone}`}><Phone className="size-3.5" /></a>
              </Button>
              {waNumber ? (
                <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs text-primary" title="שליחת הודעת וואטסאפ">
                  <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-3.5" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          {/* Email */}
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground block">כתובת אימייל</span>
              {email ? (
                <span className="font-semibold [overflow-wrap:anywhere]" dir="ltr" data-testid="customer-email">{email}</span>
              ) : (
                <span className="text-xs text-muted-foreground italic">לא הוזנה כתובת אימייל</span>
              )}
            </div>
            {email ? (
              <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs" title="שליחת מייל">
                <a href={`mailto:${email}`}><Mail className="size-3.5" /></a>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setName(fullName);
                  setPhoneVal(phone);
                  setEmailVal("");
                  setErrors({});
                  setEditOpen(true);
                }}
                className="h-7 text-xs px-2 text-primary"
                data-testid="add-email-btn"
              >
                + הוספה
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Edit Customer Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>עריכת פרטי לקוח</DialogTitle>
            <DialogDescription>עדכון שם הלקוח, מספר הטלפון וכתובת האימייל לקבלת אישורים ותזכורות.</DialogDescription>
          </DialogHeader>
          <form method="post" onSubmit={handleSave} noValidate className="grid gap-4 py-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="edit-name" className="font-medium">שם הלקוח</label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                data-testid="edit-customer-name"
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="edit-phone" className="font-medium">מספר טלפון</label>
              <Input
                id="edit-phone"
                type="tel"
                value={phoneVal}
                onChange={(e) => setPhoneVal(e.target.value)}
                dir="ltr"
                className="text-start"
                required
                data-testid="edit-customer-phone"
              />
              {errors.phone ? <p className="text-xs text-destructive">{errors.phone}</p> : null}
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="edit-email" className="font-medium">כתובת אימייל</label>
              <Input
                id="edit-email"
                type="email"
                value={emailVal}
                onChange={(e) => setEmailVal(e.target.value)}
                dir="ltr"
                className="text-start"
                placeholder="name@example.com"
                data-testid="edit-customer-email"
              />
              {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
              <p className="text-[11px] text-muted-foreground">האימייל ישמש לשליחת אישורי תורים, עדכונים ותזכורות אוטומטיות.</p>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>ביטול</Button>
              <Button type="submit" disabled={saving} data-testid="edit-customer-submit">
                {saving ? "שומר…" : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation Dialog */}
      {mergeTarget ? (
        <Dialog open={Boolean(mergeTarget)} onOpenChange={(o) => { if (!o) setMergeTarget(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>איחוד כרטיסי לקוח</DialogTitle>
              <DialogDescription>
                האם לאחד את כרטיס הלקוח של <strong>{mergeTarget.fullName}</strong> אל תוך הכרטיס הנוכחי של <strong>{fullName}</strong>?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-xs text-muted-foreground bg-muted/40 p-3 rounded-md">
              <p>• כל התורים וההיסטוריה יועברו לכרטיס הנוכחי.</p>
              <p>• רשימות ההמתנה וההערות יאוחדו.</p>
              <p>• הכרטיס הכפול יימחק מהמאגר ללא פגיעה בנתוני הדוחות.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setMergeTarget(null)}>ביטול</Button>
              <Button type="button" onClick={handleMerge} disabled={merging} data-testid="confirm-merge-btn">
                {merging ? "מאחדים…" : "כן, בצע איחוד"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

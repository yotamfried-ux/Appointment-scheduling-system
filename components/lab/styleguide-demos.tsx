"use client";

import { Bell, CalendarX2, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormField } from "@/components/patterns/form-field";
import { StatusBadge, type AppointmentStatus } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

const STATUSES: [AppointmentStatus, string][] = [
  ["pending", "ממתין לאישור"],
  ["confirmed", "מאושר"],
  ["completed", "הושלם"],
  ["noShow", "לא הגיע/ה"],
  ["cancelled", "בוטל"],
  ["available", "פנוי"],
];

export function StyleguideDemos() {
  const [invalid, setInvalid] = useState(true);
  return (
    <div className="grid gap-10">
      <section aria-labelledby="sg-buttons" className="grid gap-4">
        <h2 id="sg-buttons" className="text-xl font-bold">כפתורים</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>ראשי</Button>
          <Button variant="secondary">משני</Button>
          <Button variant="outline">מסגרת</Button>
          <Button variant="ghost">שקוף</Button>
          <Button variant="destructive">מחיקה</Button>
          <Button disabled>מושבת</Button>
          <Button size="sm">קטן</Button>
          <Button size="lg">גדול</Button>
          <Button size="icon" aria-label="הוספה"><Plus aria-hidden /></Button>
        </div>
      </section>

      <section aria-labelledby="sg-status" className="grid gap-4">
        <h2 id="sg-status" className="text-xl font-bold">סטטוס תור</h2>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(([s, label]) => <StatusBadge key={s} status={s} label={label} />)}
          <Badge>תג רגיל</Badge>
        </div>
      </section>

      <section aria-labelledby="sg-forms" className="grid gap-4">
        <h2 id="sg-forms" className="text-xl font-bold">טפסים</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="שם מלא" hint="כפי שיופיע בתור">{(a) => <Input {...a} placeholder="ישראל ישראלי" />}</FormField>
          <FormField label="טלפון" error={invalid ? "מספר הטלפון אינו תקין." : undefined}>
            {(a) => <Input {...a} type="tel" inputMode="tel" defaultValue="050-12" onChange={() => setInvalid(false)} />}
          </FormField>
          <FormField label="הערות" className="sm:col-span-2">{(a) => <Textarea {...a} rows={3} />}</FormField>
          <label className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 sm:col-span-2">
            <span>
              <span className="block font-medium">תזכורת יום לפני</span>
              <span className="block text-sm text-muted-foreground">נשלח ללקוח אימייל ב-09:00</span>
            </span>
            <Switch defaultChecked aria-label="תזכורת יום לפני" />
          </label>
        </div>
      </section>

      <section aria-labelledby="sg-overlays" className="grid gap-4">
        <h2 id="sg-overlays" className="text-xl font-bold">חלונות, תפריטים והודעות</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">חלון דו-שיח</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>לבטל את התור?</DialogTitle>
                <DialogDescription>הלקוח יקבל הודעה, והזמן יתפנה לרשימת ההמתנה.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="destructive" onClick={() => toast("התור בוטל", { variant: "success" })}>ביטול התור</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="פעולות נוספות"><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>עריכה</DropdownMenuItem>
              <DropdownMenuItem>שינוי מועד</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">מחיקה</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast("נשמר", { variant: "success", description: "השינויים נשמרו בהצלחה." })}>הודעת הצלחה</Button>
          <Button variant="outline" onClick={() => toast("אירעה שגיאה", { variant: "error", description: "נסו שוב בעוד רגע." })}>הודעת שגיאה</Button>
          <Button variant="outline" onClick={() => toast("הלקוח מבקש לבטל", { variant: "warning" })}><Bell aria-hidden />אזהרה</Button>
        </div>
      </section>

      <section aria-labelledby="sg-cards" className="grid gap-4">
        <h2 id="sg-cards" className="text-xl font-bold">כרטיסים, לשוניות ומצבים</h2>
        <Tabs defaultValue="today" className="w-full">
          <TabsList>
            <TabsTrigger value="today">היום</TabsTrigger>
            <TabsTrigger value="week">השבוע</TabsTrigger>
            <TabsTrigger value="month">החודש</TabsTrigger>
          </TabsList>
          <TabsContent value="today">
            <Card>
              <CardHeader>
                <CardTitle>8 תורים היום</CardTitle>
                <CardDescription>2 ממתינים לאישור</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="week"><EmptyState icon={<CalendarX2 className="size-6" />} title="אין עדיין תורים השבוע" description="שתפו את קישור ההזמנה כדי שלקוחות יתחילו לקבוע." action={<Button>העתקת קישור</Button>} /></TabsContent>
          <TabsContent value="month"><EmptyState title="אין נתונים להצגה" description="הנתונים יופיעו אחרי התור הראשון." /></TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

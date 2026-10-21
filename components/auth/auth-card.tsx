import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-card sm:border">
      <CardHeader className="space-y-1.5">
        <h1 data-slot="card-title" className="text-2xl leading-tight font-semibold text-balance">
          {title}
        </h1>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        {children}
        {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid="form-error" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive-soft-foreground">
      {message}
    </p>
  );
}

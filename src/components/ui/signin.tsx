import { forwardRef, useState, useEffect, useCallback } from "react";
import { type VariantProps } from "class-variance-authority";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";

export interface SignInButtonProps
  extends Omit<React.ComponentProps<"button">, "onClick">,
    VariantProps<typeof buttonVariants> {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  showIcon?: boolean;
  signInText?: string;
  signOutText?: string;
  loadingText?: string;
  asChild?: boolean;
}

// ── Auth Modal (Login + Register) ────────────────────────────────────────────
function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Tutup modal otomatis saat Convex sudah konfirmasi authenticated
  useEffect(() => {
    if (isAuthenticated) onClose();
  }, [isAuthenticated, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "register") {
        await signIn("password", { email, password, name, flow: "signUp" });
        toast.success("Akun berhasil dibuat. Selamat datang!");
      } else {
        await signIn("password", { email, password, flow: "signIn" });
        toast.success("Berhasil masuk.");
      }
      // Jangan panggil onClose() di sini — biarkan useEffect di atas yang handle
      // setelah isAuthenticated berubah jadi true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      toast.error(mode === "login" ? "Gagal masuk. Periksa email dan password." : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-black tracking-wide">
            {mode === "login" ? "Masuk ke PANIC BUTTON" : "Daftar Akun Baru"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {mode === "register" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">Nama Lengkap</Label>
              <Input
                id="auth-name"
                type="text"
                placeholder="Budi Santoso"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              placeholder="budi@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              placeholder="Minimal 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          <Button type="submit" className="w-full font-bold" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin mr-2" />}
            {mode === "login" ? "Masuk" : "Daftar"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground mt-2">
          {mode === "login" ? (
            <>
              Belum punya akun?{" "}
              <button
                type="button"
                className="text-primary font-semibold hover:underline"
                onClick={() => setMode("register")}
              >
                Daftar di sini
              </button>
            </>
          ) : (
            <>
              Sudah punya akun?{" "}
              <button
                type="button"
                className="text-primary font-semibold hover:underline"
                onClick={() => setMode("login")}
              >
                Masuk
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SignInButton ──────────────────────────────────────────────────────────────
export const SignInButton = forwardRef<HTMLButtonElement, SignInButtonProps>(
  (
    {
      onClick,
      disabled,
      showIcon = true,
      signInText = "Masuk",
      signOutText = "Keluar",
      loadingText,
      className,
      variant,
      size,
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const { signOut } = useAuthActions();
    const { isAuthenticated, isLoading } = useConvexAuth();
    const [modalOpen, setModalOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (isAuthenticated) {
        setSigningOut(true);
        try {
          await signOut();
        } finally {
          setSigningOut(false);
        }
      } else {
        setModalOpen(true);
      }
    };

    const busy = isLoading || signingOut;
    const isDisabled = disabled || busy;

    const buttonText = busy
      ? (loadingText ?? (isAuthenticated ? "Keluar..." : "Memuat..."))
      : isAuthenticated
        ? signOutText
        : signInText;

    const icon = busy ? (
      <Loader2 className="size-4 animate-spin" />
    ) : isAuthenticated ? (
      <LogOut className="size-4" />
    ) : (
      <LogIn className="size-4" />
    );

    return (
      <>
        <Button
          ref={ref}
          onClick={handleClick}
          disabled={isDisabled}
          variant={variant}
          size={size}
          className={className}
          asChild={asChild}
          aria-label={isAuthenticated ? "Keluar dari akun" : "Masuk ke akun"}
          {...props}
        >
          {showIcon && icon}
          {buttonText}
        </Button>
        <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  },
);

SignInButton.displayName = "SignInButton";

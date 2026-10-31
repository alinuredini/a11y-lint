import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  return <Input type="password" {...props} />;
}

export function Login() {
  return (
    <form>
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" autoComplete="email" />
      <PasswordInput aria-label="Password" />
    </form>
  );
}

import { Button } from '@/components/ui/button';
import { Field, IconButton } from '@/components';
import { TrashIcon } from 'lucide-react';

export function Page() {
  return (
    <main>
      <Button>Save</Button>
      <IconButton><TrashIcon /></IconButton>
      <Field label="Email"><input type="email" autoComplete="email" /></Field>
      <div onClick={() => {}}><Button>Inside</Button></div>
    </main>
  );
}

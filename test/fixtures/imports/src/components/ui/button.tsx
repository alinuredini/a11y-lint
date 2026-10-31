import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

function Button({ asChild = false, ...props }: { asChild?: boolean } & React.ComponentProps<'button'>) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" {...props} />;
}

export { Button };

import { Input, SearchBox } from '@/components/ui/input';
import { IconButton } from '@/components';
import { TrashIcon } from 'lucide-react';

export function Form() {
  return (
    <form>
      <Input placeholder="Search" />
      <Input aria-label="Name" />
      <SearchBox placeholder="ignored, not forwarded" />
      <IconButton aria-label="Delete"><TrashIcon /></IconButton>
    </form>
  );
}

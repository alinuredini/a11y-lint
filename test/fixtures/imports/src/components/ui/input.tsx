function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={className} {...props} />;
}

function SearchBox() {
  return <input type="search" aria-label="Search" />;
}

export { Input, SearchBox };

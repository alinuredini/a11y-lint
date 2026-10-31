import * as LabelPrimitive from '@radix-ui/react-label';

const Label = React.forwardRef(({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={className} {...props} />);

export { Label };

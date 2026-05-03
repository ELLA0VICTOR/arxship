import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

function Label({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      className={cn('text-xs font-black uppercase tracking-[0.18em] text-white/80', className)}
      {...props}
    />
  )
}

export { Label }

import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import '@/components/ui/8bit/styles/retro.css'

const buttonVariants = cva(
  'retro inline-flex items-center justify-center gap-2 border-2 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] transition disabled:pointer-events-none disabled:opacity-50 sm:px-4 sm:text-xs sm:tracking-[0.18em]',
  {
    variants: {
      variant: {
        default: 'border-white bg-white text-black shadow-pixel hover:-translate-y-0.5 hover:bg-black hover:text-white',
        secondary: 'border-white/35 bg-black text-white shadow-pixel hover:-translate-y-0.5 hover:border-white',
        destructive: 'border-white bg-white text-black shadow-pixel hover:-translate-y-0.5 hover:bg-black hover:text-white',
        ghost: 'border-transparent bg-transparent text-white hover:bg-white/10',
      },
      size: {
        default: 'h-12',
        sm: 'h-9 px-3',
        lg: 'h-12 px-4 sm:h-14 sm:px-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }

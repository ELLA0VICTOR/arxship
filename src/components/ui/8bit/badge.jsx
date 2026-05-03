import { cn } from '@/lib/utils'
import '@/components/ui/8bit/styles/retro.css'

function Badge({ className, variant = 'default', ...props }) {
  const variants = {
    default: 'border-white bg-white text-black',
    secondary: 'border-white/30 bg-black text-white',
    warning: 'border-white bg-white text-black',
    destructive: 'border-white bg-black text-white',
    success: 'border-white bg-white text-black',
  }

  return (
    <span
      className={cn(
        'retro inline-flex items-center border-2 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]',
        variants[variant] || variants.default,
        className
      )}
      {...props}
    />
  )
}

export { Badge }

import { cn } from '@/lib/utils'
import '@/components/ui/8bit/styles/retro.css'

function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'retro flex h-12 w-full border-2 border-white/30 bg-black px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-white focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }

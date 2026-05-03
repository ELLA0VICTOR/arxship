import { cn } from '@/lib/utils'

function Spinner({ className }) {
  return (
    <span
      className={cn(
        'inline-block h-5 w-5 animate-spin border-4 border-white/20 border-t-white',
        className
      )}
      aria-label="Loading"
    />
  )
}

export { Spinner }

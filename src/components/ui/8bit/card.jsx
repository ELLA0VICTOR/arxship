import { cn } from '@/lib/utils'
import '@/components/ui/8bit/styles/retro.css'

function Card({ className, ...props }) {
  return (
    <div
      className={cn('retro border-2 border-white/24 bg-black/90 p-5 shadow-pixel', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }) {
  return <div className={cn('mb-4 space-y-2', className)} {...props} />
}

function CardTitle({ className, ...props }) {
  return <h3 className={cn('font-pixel text-sm uppercase tracking-[0.12em] text-white', className)} {...props} />
}

function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm leading-6 text-white/62', className)} {...props} />
}

function CardContent({ className, ...props }) {
  return <div className={cn('space-y-4', className)} {...props} />
}

function CardFooter({ className, ...props }) {
  return <div className={cn('mt-5 flex items-center gap-3', className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }

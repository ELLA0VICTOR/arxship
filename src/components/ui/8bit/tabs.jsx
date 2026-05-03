import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'
import '@/components/ui/8bit/styles/retro.css'

const Tabs = TabsPrimitive.Root

function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn('grid gap-2 rounded-none md:inline-grid md:auto-cols-fr md:grid-flow-col', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'retro border-2 border-white/24 bg-black px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white/62 transition data-[state=active]:border-white data-[state=active]:bg-white data-[state=active]:text-black',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn('mt-6 outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

import { AIRPORTS, type AirportCode } from '@job-queue/contracts';
import { ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { SubstringAirportSearch } from '../model/airport-search';

/**
 * An airport field of the transit form: a button that opens a searchable list of the bundled
 * airports. Only listed airports can be chosen; the closed field shows the chosen code and name.
 */
export function AirportCombobox({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: AirportCode | '';
  onChange: (code: AirportCode) => void;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const search = useMemo(() => new SubstringAirportSearch({ airports: AIRPORTS }), []);
  const chosen = AIRPORTS.find((airport) => airport.iata === value);
  const { airports } = search.find({ text });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-base shadow-xs outline-none md:text-sm',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-invalid:border-destructive',
          )}
        >
          <span className={cn('truncate', chosen ? 'font-mono' : 'text-muted-foreground')}>
            {chosen ? en.submit.airportChosen(chosen.iata, chosen.name) : en.submit.chooseAirport}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 flex-none opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 bg-card p-0 text-foreground"
      >
        <Command shouldFilter={false} className="bg-card text-foreground">
          <CommandInput
            value={text}
            onValueChange={setText}
            placeholder={en.submit.searchAirport}
          />
          <CommandList>
            <CommandEmpty>{en.submit.noAirport}</CommandEmpty>
            {airports.map((airport) => (
              <CommandItem
                key={airport.iata}
                value={airport.iata}
                onSelect={() => {
                  onChange(airport.iata as AirportCode);
                  setOpen(false);
                  setText('');
                }}
              >
                {en.submit.airportOption(airport.iata, airport.name, airport.city)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

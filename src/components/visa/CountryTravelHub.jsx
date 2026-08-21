import { useMemo } from 'react';
import {
  Heart, ThumbsDown, CheckCircle2, XCircle, Sun, ShieldCheck,
  Wifi, Camera, CalendarDays,
  Compass, Languages, Banknote, Phone, ArrowRight,
  CircleParking, BedDouble, Info, BriefcaseBusiness,
} from 'lucide-react';

const UAE = {
  code: 'AE',
  eyebrow: 'United Arab Emirates travel guide',
  intro: 'A practical UAE hub for Indian travellers — visa, cities, transport, airports, cruises, neighbourhoods, food, culture and the small details that make a trip easier.',
  quick: [
    ['Best for', 'City breaks · families · shopping · beaches · luxury'],
    ['Main hubs', 'Dubai · Abu Dhabi'],
    ['Language', 'Arabic · English widely used'],
    ['Currency', 'UAE dirham (AED)'],
    ['Time', 'GST · 1.5 hours behind India'],
    ['Trip length', '4–7 days works well for a first visit'],
  ],
  cities: [
    { name: 'Dubai', tag: 'Best first stop', text: 'Fast, polished and easy to navigate. Downtown, Marina, JBR, Palm Jumeirah, Old Dubai and Deira each feel different.', best: 'Shopping, attractions, nightlife, families, beaches' },
    { name: 'Abu Dhabi', tag: 'Culture + calm', text: 'More spacious and relaxed than Dubai, with major museums, grand architecture, beaches and Yas Island attractions.', best: 'Culture, families, resorts, theme parks' },
    { name: 'Sharjah', tag: 'Culture + value', text: 'A quieter, more conservative emirate next to Dubai, known for museums, waterfront areas and comparatively better-value stays.', best: 'Museums, families, value stays' },
    { name: 'Ras Al Khaimah', tag: 'Mountains + resorts', text: 'A resort-led escape with desert, beaches and Jebel Jais. Good for travellers who want outdoor activities away from big-city pace.', best: 'Resorts, couples, adventure' },
    { name: 'Ajman', tag: 'Small + relaxed', text: 'Compact, beach-oriented and close to Sharjah and Dubai. Often chosen for a slower stay and simple waterfront time.', best: 'Beach breaks, quieter stays' },
    { name: 'Fujairah', tag: 'East coast', text: 'Mountain scenery, diving and Indian Ocean beaches make it different from the Gulf-facing emirates.', best: 'Diving, road trips, nature' },
  ],
  places: [
    ['Dubai classics', 'Burj Khalifa · Dubai Mall · Dubai Fountain area · Museum of the Future · Dubai Frame'],
    ['Beach & waterfront', 'JBR · Kite Beach · Dubai Marina · Palm Jumeirah · Bluewaters'],
    ['Old Dubai', 'Al Fahidi · Dubai Creek · souks · abra ride · Deira'],
    ['Abu Dhabi', 'Sheikh Zayed Grand Mosque · Louvre Abu Dhabi · Corniche · Qasr Al Watan · Yas Island'],
    ['Nature', 'Jebel Jais · Hatta · Fujairah coast · desert conservation areas'],
    ['Family', 'Aquariums · water parks · theme parks · indoor attractions · desert experiences'],
  ],
  airports: [
    { code: 'DXB', name: 'Dubai International', note: 'The main international gateway for Dubai and one of the easiest arrivals for a first UAE trip.' },
    { code: 'DWC', name: 'Al Maktoum International', note: 'Dubai’s secondary airport; check your airline and transfer time carefully because it is far from central Dubai.' },
    { code: 'AUH', name: 'Zayed International Airport', note: 'The main Abu Dhabi gateway with good access to Yas Island and Abu Dhabi city.' },
    { code: 'SHJ', name: 'Sharjah International', note: 'Useful for Sharjah and many low-cost routes; road traffic into Dubai can materially affect transfer time.' },
    { code: 'RKT', name: 'Ras Al Khaimah International', note: 'Useful for selected RAK-focused itineraries and resort stays.' },
  ],
  transport: [
    ['Dubai Metro', 'The simplest way to cover many major Dubai corridors. Use taxis or short walks for the last mile.'],
    ['Taxi / ride hail', 'Extremely useful in Dubai and Abu Dhabi, especially for families, evenings and attractions away from metro stations.'],
    ['Buses', 'Useful within and between emirates, but journey planning matters more than in metro-connected areas.'],
    ['Rental car', 'Best when combining emirates, resorts, Hatta, Jebel Jais or Fujairah. Parking and traffic vary by area.'],
    ['Inter-emirate travel', 'Dubai–Abu Dhabi is primarily road based. Budget generous time around peak periods.'],
    ['Trains', 'Do not plan a tourist itinerary around a nationwide passenger rail network yet; for most visitors, road and city transit remain the practical options.'],
  ],
  cruises: [
    ['Dubai cruise stay', 'Dubai is a major Gulf cruise home-port/stopover. Add at least one hotel night before departure when arriving on a separate international ticket.'],
    ['Abu Dhabi cruise stay', 'Cruise calls pair well with the Grand Mosque, Louvre Abu Dhabi, Corniche and Yas Island depending on port time.'],
    ['Port-day planning', 'Use conservative return times. Port location, traffic and security re-entry can make “close on the map” misleading.'],
    ['Gulf itineraries', 'Common regional combinations may include UAE ports with Oman, Qatar or Bahrain depending on cruise line and season. Always check entry rules for every port.'],
  ],
  food: [
    ['Emirati flavours', 'Machboos, grilled meats, dates, Arabic coffee, luqaimat and Gulf-style seafood are good starting points.'],
    ['Indian food', 'Indian food is exceptionally easy to find, from budget vegetarian meals to premium regional restaurants.'],
    ['Where food gets interesting', 'Old Dubai, Deira, Karama, Satwa and neighbourhood restaurants often deliver more local character than mall-only dining.'],
    ['Alcohol', 'Rules and availability vary by emirate and licensed venue. Never assume the same rules apply everywhere.'],
  ],
  loves: [
    'Clean, highly organised public spaces and modern infrastructure',
    'Very strong restaurant variety, especially Indian, Middle Eastern and international food',
    'Easy taxis, polished malls and family-friendly indoor attractions',
    'Winter weather, beaches, desert landscapes and dramatic skylines',
    'A trip can be premium or surprisingly practical depending on neighbourhood and activity choices',
  ],
  complaints: [
    'Heat can make outdoor plans exhausting for much of the year',
    'Taxis, attractions and premium restaurants add up quickly',
    'Popular sights can feel crowded, commercial and highly curated',
    'Dubai traffic can turn short-looking road journeys into long transfers',
    'Distances between neighbourhoods are easy to underestimate',
  ],
  do: [
    'Keep passport and visa/entry documents accessible while travelling.',
    'Dress respectfully at mosques, government buildings and culturally sensitive places.',
    'Carry sun protection and water; indoor air-conditioning can also feel very cold.',
    'Check attraction time slots before crossing the city.',
    'Build buffer time for airport, cruise and inter-emirate transfers.',
    'Use official or reputable transport and ticket channels.',
  ],
  avoid: [
    'Do not photograph people closely without consent, especially families or sensitive locations.',
    'Avoid public arguments, aggressive behaviour and disrespectful gestures.',
    'Do not assume nightlife, alcohol or dress norms are identical across all emirates.',
    'Do not leave airport transfers or cruise-port returns to the last minute.',
    'Avoid carrying restricted medicines or substances without checking the applicable UAE rules first.',
    'Do not rely on social-media travel claims for immigration or legal requirements; verify official rules.',
  ],
  weather: [
    ['Nov–Mar', 'Best outdoor season', 'Comfortable for beaches, walking, desert trips and sightseeing; also the busiest period.'],
    ['Apr–May', 'Hotter shoulder season', 'Still workable with smarter timing, but midday outdoor activity becomes less comfortable.'],
    ['Jun–Sep', 'Very hot', 'Plan around indoor attractions, pools, evening activity and short transfers.'],
    ['Oct', 'Transition', 'Heat eases and outdoor plans become more practical as the month progresses.'],
  ],
  stays: [
    ['Downtown Dubai', 'Iconic first-trip base; excellent for Burj Khalifa/Dubai Mall, usually pricier.'],
    ['Dubai Marina / JBR', 'Beach + restaurants + evening energy; attractive for couples and families.'],
    ['Deira / Bur Dubai', 'Older city character, Indian food, souks and value-oriented hotels.'],
    ['Palm Jumeirah', 'Resort experience; best when the hotel itself is part of the trip.'],
    ['Yas Island, Abu Dhabi', 'Ideal for theme parks, entertainment and short family stays.'],
    ['Saadiyat, Abu Dhabi', 'High-end beaches, resorts and cultural attractions.'],
  ],
  practical: [
    { icon: Wifi, title: 'Connectivity', text: 'Airport SIM/eSIM and local mobile plans are easy to arrange. Hotel and mall Wi-Fi are widespread.' },
    { icon: Banknote, title: 'Money', text: 'Cards are widely accepted. Keep some AED for small purchases, tips, taxis or situations where cards are inconvenient.' },
    { icon: Languages, title: 'Language', text: 'Arabic is the official language; English is widely used in tourism, transport, restaurants and hotels.' },
    { icon: ShieldCheck, title: 'Safety', text: 'The UAE is generally easy for tourists to navigate, but local laws and public-behaviour rules should be taken seriously.' },
    { icon: Phone, title: 'Apps', text: 'Keep airline, maps, hotel, taxi/ride-hail and attraction booking apps ready before arrival.' },
    { icon: CircleParking, title: 'Driving', text: 'Roads are excellent, but lane changes, toll systems, parking and peak-hour traffic need attention.' },
  ],
  itineraries: [
    ['3 days', 'Dubai essentials', 'Downtown + Old Dubai · Marina/JBR + Palm · desert or Museum of the Future + shopping'],
    ['5 days', 'Dubai + Abu Dhabi', '3 days Dubai · 1 full Abu Dhabi cultural day · 1 flexible beach/theme-park/desert day'],
    ['7 days', 'UAE sampler', 'Dubai · Abu Dhabi · one resort/nature extension such as RAK, Hatta or Fujairah'],
  ],
};

function buildGenericGuide(country) {
  if (!country?.name) return null;
  const name = country.name; const region = country.region || 'the region';
  return { code: country.code, eyebrow: `${name} travel guide for Indian travellers`, intro: `A practical ${name} hub for Indian travellers — visa and entry guidance, cities, transport, airports, cruises, stays, food, culture, weather and trip-planning essentials in one place.`,
  quick: [['Destination', name], ['Region', region], ['Traveller lens', 'Indian passport holders'], ['Visa', 'Verified route shown above'], ['Planning', 'Cities · transport · stays · food'], ['Updates', 'Check rules before booking']],
  cities: [{name:`Explore ${name}`,tag:'Start here',text:`Compare the main cities and regions of ${name} before choosing where to stay.`,best:'First-time visitors, trip planning'},{name:'Capital & major hubs',tag:'City planning',text:'Compare the capital, major arrival hubs and tourism centres by connectivity, attractions, pace and accommodation.',best:'Culture, transport, short stays'},{name:'Beyond the main city',tag:'Go deeper',text:'Add a secondary city, coast, countryside or nature region when your itinerary allows.',best:'Longer trips, repeat visitors'}],
  places: [['Landmarks',`Prioritise the defining landmarks, historic districts and signature experiences of ${name}.`],['Culture','Look for museums, heritage areas, markets, architecture and local cultural experiences.'],['Nature','Check national parks, beaches, mountains, islands or scenic regions that fit your route.'],['Families','Shortlist family-friendly attractions and keep realistic transfer and rest time.'],['Shopping','Compare local markets, shopping districts and tax/refund rules before large purchases.'],['Day trips','Choose day trips by actual travel time rather than map distance alone.']],
  airports:[{code:'AIR',name:`${name} international gateways`,note:`Compare the main international airports serving ${name}, city transfer times and India connectivity before booking.`},{code:'CITY',name:'City airport transfers',note:'Check rail, metro, bus, taxi and official transfer choices for your exact arrival airport.'},{code:'XFER',name:'Connections & self-transfers',note:'Separate tickets may require baggage collection, re-check-in, terminal changes or additional entry formalities.'}],
  transport:[['Urban transport',`Check metro, tram, bus and local transit options in the cities you plan to visit in ${name}.`],['Taxis / ride hail','Useful for luggage, families, late arrivals and places poorly served by public transport.'],['Intercity trains','Where rail exists, compare journey time, advance-booking rules and station locations.'],['Buses / coaches','Often useful for secondary cities and budget intercity travel.'],['Rental car','Check licence, toll, parking and insurance rules before driving.'],['Domestic flights','For large countries or island routes, domestic flights can save substantial travel time.']],
  cruises:[['Cruise entry rules',`If your ${name} itinerary includes a cruise, verify immigration rules for every port and your exact passport.`],['Port transfers','Check the actual cruise terminal, city distance and conservative return time before sightseeing.'],['Pre-cruise buffer','When flying separately, arriving at least a day before sailing reduces missed-departure risk.'],['Regional itineraries','One country visa does not automatically cover every port on a multi-country cruise.']],
  food:[['Local cuisine','Try regional dishes and local specialties rather than limiting meals to international chains.'],['Indian food','Major tourism cities commonly have Indian options, but availability varies outside large urban centres.'],['Markets & neighbourhoods','Food markets and neighbourhood restaurants can offer more local character than tourist districts.'],['Dietary needs','Save translated dietary restrictions and research suitable options before travel.']],
  loves:[`Discovering the culture and character unique to ${name}`,'Trying local food and neighbourhoods beyond headline attractions','Combining major landmarks with less crowded experiences','Using local transport where it is simple and reliable','Building a trip around a few strong experiences rather than rushing everything'], complaints:['Underestimating travel time between attractions or cities','Overpacked itineraries with too many hotel changes','Unexpected transport, attraction or tourist-area costs','Weather disrupting plans when seasonality was ignored','Relying on outdated social-media advice for entry or local rules'],
  do:['Verify passport, visa and entry requirements before non-refundable bookings.','Keep digital and offline copies of important travel documents.','Learn basic local etiquette and dress expectations.','Check opening days, advance reservations and local holidays.','Keep buffer time for airports, trains, ferries and cruise terminals.','Use reputable transport, accommodation and activity providers.'], avoid:['Do not rely on old blogs or social posts for immigration requirements.','Avoid carrying restricted medicines, food or goods without checking customs rules.','Do not assume laws and public-behaviour norms are the same as India.','Avoid extremely tight self-transfer connections.','Do not keep all money, cards and documents in one place.','Avoid overplanning every hour of the trip.'],
  weather:[['Peak season','Best-known travel window',`Check ${name}'s regional climate before booking.`],['Shoulder season','Balance cost + crowds','Can offer better value with manageable weather depending on region.'],['Low season','Lower demand','May bring heat, cold, rain or closures; confirm what is operating.'],['Your dates','Check before departure','Review the forecast, daylight hours and local events close to travel.']], stays:[['Central city','Best for a short first visit and reducing daily transport time.'],['Transport hub','Useful for multi-city itineraries and early departures.'],['Neighbourhood stay','Often better for food, local atmosphere and longer visits.'],['Resort / coast','Choose when the property and relaxation are a major part of the trip.'],['Airport area','Useful for overnight connections, not automatically best for sightseeing.'],['Secondary city','Can add value, local character and a different pace to a longer itinerary.']],
  practical:[{icon:Wifi,title:'Connectivity',text:'Compare roaming, local SIM and eSIM options before arrival.'},{icon:Banknote,title:'Money',text:'Know the local currency, card acceptance, ATM fees and when cash is useful.'},{icon:Languages,title:'Language',text:'Save key phrases and offline translation where English may be less common.'},{icon:ShieldCheck,title:'Safety & laws',text:'Follow official travel guidance and local laws.'},{icon:Phone,title:'Useful apps',text:'Keep maps, airline, hotel, local transport and translation apps ready.'},{icon:CircleParking,title:'Driving',text:'Check licence validity, road rules, tolls, parking and insurance before renting.'}], itineraries:[['3 days',`${name} essentials`,'One main city · signature landmarks · one local neighbourhood or food experience'],['5 days','City + extension','Main city · second district/city · one culture or nature day'],['7 days',`${name} sampler`,'Two or three bases at most · major highlights · one slower flexible day']] };
}

const navItems = [
  ['overview', 'Overview'], ['visa-guide', 'Visa'], ['cities', 'Cities'], ['things-to-do', 'Things to do'],
  ['transport', 'Getting around'], ['airports', 'Airports'], ['cruises', 'Cruises'], ['stay', 'Where to stay'],
  ['food', 'Food'], ['local-insight', 'Local insight'], ['dos-donts', 'Do / avoid'], ['weather', 'Weather'], ['itineraries', 'Itineraries'],
];

function Section({ id, eyebrow, title, children }) {
  return <section id={id} className="scroll-mt-28 border-t border-slate-200/80 py-10 sm:py-12">
    {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">{eyebrow}</p>}
    <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">{title}</h2>
    <div className="mt-6">{children}</div>
  </section>;
}

function InfoGrid({ items }) {
  return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
    {items.map(([title, text]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </article>)}
  </div>;
}

export default function CountryTravelHub({ country, entry }) {
  const guide = useMemo(() => country?.code === 'AE' ? UAE : buildGenericGuide(country), [country?.code, country?.name, country?.region]);
  if (!guide) return null;

  return <div className="mx-auto mt-10 max-w-6xl px-4 sm:px-5">
    <section id="overview" className="scroll-mt-28 overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 text-white">
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_.8fr] lg:p-10">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-orange-300"><Compass size={14}/> Complete country guide</div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{guide.eyebrow}</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">Plan the whole {country?.name} trip, not just the visa.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{guide.intro}</p>
          <div className="mt-7 flex flex-wrap gap-2">
            {['Visa intelligence', 'Indian traveller lens', 'Cities', 'Flights', 'Cruises', 'Local tips'].map(x => <span key={x} className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-slate-200">{x}</span>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-end">
          {guide.quick.map(([k,v]) => <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p><p className="mt-1 text-sm font-medium leading-5 text-white">{v}</p></div>)}
        </div>
      </div>
    </section>

    <div className="sticky top-0 z-30 -mx-4 mt-4 border-y border-slate-200 bg-[#fcfbf9]/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
      <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(([id,label]) => <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">{label}</a>)}
      </div>
    </div>

    <Section id="visa-guide" eyebrow="Entry & visa" title="Start with the verified visa route">
      <div className="grid gap-4 lg:grid-cols-[1fr_.75fr]">
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 sm:p-6">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-orange-600 p-2 text-white"><BriefcaseBusiness size={18}/></div><div><h3 className="font-semibold text-slate-950">Krosz visa intelligence stays the source of truth</h3><p className="mt-1 text-sm leading-6 text-slate-700">Eligibility, documents, processing route, fees and application actions remain powered by the verified visa engine above. This travel guide does not override live immigration rules.</p></div></div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Route status</p><p className="mt-1 text-sm font-semibold text-slate-900">{entry?.ready_for_public ? 'Verified route available' : 'Check eligibility'}</p></div>
            <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Passport</p><p className="mt-1 text-sm font-semibold text-slate-900">Indian</p></div>
            <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Purpose</p><p className="mt-1 text-sm font-semibold text-slate-900">Tourism</p></div>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="font-semibold text-slate-950">Before you book</h3><div className="mt-4 space-y-3 text-sm text-slate-600">{['Confirm passport validity and the exact entry route.', 'Match airline, hotel and visa dates before payment.', 'Check every traveller separately for family/group trips.', 'Keep copies of bookings and travel insurance details.'].map(x => <div key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-600"/><span>{x}</span></div>)}</div></div>
      </div>
    </Section>

    <Section id="cities" eyebrow="Where to go" title="The cities and emirates feel very different">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{guide.cities.map(c => <article key={c.name} className="group rounded-3xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/40"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-slate-950">{c.name}</h3><span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700">{c.tag}</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{c.text}</p><p className="mt-4 text-xs font-medium text-slate-500">Best for · {c.best}</p></article>)}</div>
    </Section>

    <Section id="things-to-do" eyebrow="Experiences" title="What to see and do">
      <InfoGrid items={guide.places}/>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start gap-3"><Camera className="mt-0.5 h-5 w-5 text-orange-600"/><div><h3 className="font-semibold text-slate-950">A better first-trip rule</h3><p className="mt-1 text-sm leading-6 text-slate-600">Do not fill every hour with landmarks. Pick one major zone per half-day and leave room for meals, traffic, hotel time and spontaneous stops.</p></div></div></div>
    </Section>

    <Section id="transport" eyebrow="Movement" title="How to get around the UAE">
      <InfoGrid items={guide.transport}/>
    </Section>

    <Section id="airports" eyebrow="Flights" title="Know which airport you are actually using">
      <div className="grid gap-3 md:grid-cols-2">{guide.airports.map(a => <article key={a.code} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-bold text-white">{a.code}</div><div><h3 className="font-semibold text-slate-950">{a.name}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{a.note}</p></div></article>)}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">{[['From India', 'Dubai, Abu Dhabi and Sharjah have extensive India connectivity; compare total trip cost, not airfare alone.'], ['Arrival planning', 'Check terminal, hotel transfer distance, baggage allowance and landing time before choosing the cheapest fare.'], ['Self-transfer warning', 'Separate tickets can require baggage collection, re-check-in and extra immigration/visa considerations.']].map(([a,b]) => <div key={a} className="rounded-2xl bg-slate-100 p-4"><p className="text-sm font-semibold text-slate-900">{a}</p><p className="mt-1 text-sm leading-6 text-slate-600">{b}</p></div>)}</div>
    </Section>

    <Section id="cruises" eyebrow="At sea" title="Cruises and port-day planning">
      <InfoGrid items={guide.cruises}/>
    </Section>

    <Section id="stay" eyebrow="Neighbourhoods" title="Where to stay changes the entire trip">
      <InfoGrid items={guide.stays}/>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex gap-3"><BedDouble className="mt-0.5 h-5 w-5 text-orange-600"/><p className="text-sm leading-6 text-slate-600"><strong className="text-slate-900">Booking principle:</strong> a cheaper hotel far from your daily plans may cost more after taxis and lost time. Choose the area first, hotel second.</p></div></div>
    </Section>

    <Section id="food" eyebrow="Eat & drink" title="What people love eating here">
      <InfoGrid items={guide.food}/>
    </Section>

    <Section id="local-insight" eyebrow="What visitors actually notice" title="What people love — and what commonly frustrates them">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6"><div className="flex items-center gap-2"><Heart className="h-5 w-5 text-emerald-700"/><h3 className="font-semibold text-emerald-950">People often love</h3></div><div className="mt-4 space-y-3">{guide.loves.map(x => <div key={x} className="flex gap-2 text-sm leading-6 text-emerald-950/80"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0"/>{x}</div>)}</div></div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-6"><div className="flex items-center gap-2"><ThumbsDown className="h-5 w-5 text-amber-700"/><h3 className="font-semibold text-amber-950">Common traveller complaints</h3></div><div className="mt-4 space-y-3">{guide.complaints.map(x => <div key={x} className="flex gap-2 text-sm leading-6 text-amber-950/80"><Info className="mt-1 h-4 w-4 shrink-0"/>{x}</div>)}</div></div>
      </div>
    </Section>

    <Section id="dos-donts" eyebrow="Local etiquette" title="What to do — and what to avoid">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="flex items-center gap-2 font-semibold text-slate-950"><CheckCircle2 className="h-5 w-5 text-emerald-600"/>Do</h3><div className="mt-4 space-y-3">{guide.do.map(x => <p key={x} className="text-sm leading-6 text-slate-600">• {x}</p>)}</div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><h3 className="flex items-center gap-2 font-semibold text-slate-950"><XCircle className="h-5 w-5 text-rose-600"/>Avoid</h3><div className="mt-4 space-y-3">{guide.avoid.map(x => <p key={x} className="text-sm leading-6 text-slate-600">• {x}</p>)}</div></div>
      </div>
    </Section>

    <Section id="weather" eyebrow="When to go" title="Plan around the heat, not just the airfare">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">{guide.weather.map(([month,label,text]) => <article key={month} className="rounded-2xl border border-slate-200 bg-white p-5"><Sun className="h-5 w-5 text-orange-600"/><p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{month}</p><h3 className="mt-1 font-semibold text-slate-950">{label}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}</div>
    </Section>

    <Section id="practical" eyebrow="Essentials" title="Small things that make the trip easier">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{guide.practical.map(({icon:Icon,title,text}) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5"><Icon className="h-5 w-5 text-orange-600"/><h3 className="mt-4 font-semibold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}</div>
    </Section>

    <Section id="itineraries" eyebrow="Trip planner" title="Simple first-trip itineraries">
      <div className="grid gap-4 lg:grid-cols-3">{guide.itineraries.map(([days,title,text]) => <article key={days} className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">{days}</span><CalendarDays className="h-5 w-5 text-orange-600"/></div><h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}</div>
    </Section>

    <section className="mb-12 rounded-[30px] bg-orange-600 p-6 text-white sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-100">One country · one complete hub</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Visa sorted. Trip understood.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-orange-50">Verified entry rules on top, practical travel intelligence underneath — one complete {country?.name} travel hub.</p></div><a href="#visa-guide" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-orange-700">Review visa <ArrowRight size={16}/></a></div>
    </section>
  </div>;
}

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { getSupabase } from '@/lib/supabase/client';
import { rows, uploadEquipmentImage as uploadPhoto } from '@/lib/workspace';
import {
  Eye,
  Mail,
  BadgeCheck,
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Cpu,
  Download,
  Filter,
  Gauge,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
  X,
  Zap,
  HandHeart,
  Trophy,
  Ban,
  Rotate3D,
  Medal,
} from 'lucide-react';

type Member = {
  id: string;
  name: string;
  team: string;
  rep: number;
  avatar?: string;
  grade?: string;
  role?: Role;
  status?: 'active' | 'suspended' | 'banned';
  suspendedUntil?: string;
  statusReason?: string;
  achievements?: string[];
};
type ActivityEntry = {
  id: string | string;
  title: string;
  detail: string;
  kind: 'blue' | 'green' | 'gold' | 'red';
  at: string;
  actor?: string;
};
type ServerNotification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  actor?: { id: string; full_name: string } | null;
};
type RepEntry = {
  id: string;
  member: string;
  points: number;
  reason: string;
  actor: string;
  at: string;
};
type Preferences = {
  borrowDays: number;
  graceDays: number;
  requestLimit: number;
  onTimePoints: number;
  latePenalty: number;
  nonReturnPenalty: number;
};
const DEFAULT_PREFS: Preferences = {
  borrowDays: 7,
  graceDays: 1,
  requestLimit: 3,
  onTimePoints: 5,
  latePenalty: 5,
  nonReturnPenalty: 20,
};
export type Role =
  'Super Admin' | 'Admin' | 'Moderator' | 'Secretary' | 'Member';
export type Account = { id: string; name: string; email: string; role: Role };
type Product = {
  id: string;
  name: string;
  category: string;
  code: string;
  available: number;
  total: number;
  cap: number;
  image: string;
  condition: string;
  description?: string;
  views?: string[];
};
type Request = {
  memberId: string;
  id: string;
  member: string;
  product: string;
  qty: number;
  date: string;
  due: string;
  status:
    | 'Pending'
    | 'Approved'
    | 'Rejected'
    | 'Returned'
    | 'Non-return'
    | 'Cancelled';
  purpose: string;
  projectDeadline?: string;
};
const changedViews: Record<string, string[]> = {
  submit_request: ['requests'],
  review_request: ['products', 'requests', 'notifications'],
  close_loan: ['products', 'requests', 'members', 'reputation'],
  submit_contribution: ['donations'],
  review_contribution: [
    'contribution_total',
    'donations',
    'products',
    'members',
    'reputation',
    'notifications',
  ],
  promote_member: ['members'],
  manage_member: ['members', 'reputation', 'notifications'],
  edit_profile: ['members', 'requests', 'donations', 'reputation'],
  save_equipment: ['products'],
  set_preference: ['preferences'],
  read_notification: ['notifications'],
};
const initials = (n: string) =>
  n
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const staffNav = [
  ['Overview', LayoutDashboard],
  ['Equipment', Package],
  ['Requests', ClipboardIcon],
  ['Loans & returns', Boxes],
  ['Members', Users],
  ['Activity log', Activity],
  ['Settings', Settings],
] as const;
const memberNav = [
  ['Overview', LayoutDashboard],
  ['Equipment', Package],
  ['Requests', ClipboardIcon],
  ['Loans & returns', Boxes],
  ['Members', Users],
  ['Donation / Lend', HandHeart],
] as const;
function ClipboardIcon(props: React.ComponentProps<typeof Package>) {
  return <CheckCircle2 {...props} />;
}
const guide: [string, React.ComponentType<{ size?: number }>, string][] = [
  [
    'Equipment',
    Package,
    'Browse the catalogue, check live stock and open item details.',
  ],
  [
    'Requests',
    ClipboardIcon,
    'Ask to borrow gear. Admins and secretaries review each request.',
  ],
  [
    'Loans & returns',
    Boxes,
    'See what is out, when it is due and record returns.',
  ],
  ['Members', Users, 'The club roster with teams and reputation scores.'],
  [
    'Activity log',
    Activity,
    'A timeline of every approval, return and change.',
  ],
  [
    'Settings',
    Settings,
    'Set the borrowing period, grace days and reputation rules.',
  ],
];
const TODAY = new Date().toLocaleDateString('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
});
function dueIn(due: string) {
  const d = Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5);
  return d < 0
    ? `${-d} day${d === -1 ? '' : 's'} overdue`
    : d === 0
      ? 'due today'
      : `in ${d} day${d === 1 ? '' : 's'}`;
}
function stockLevel(p: { available: number; total: number }) {
  const r = p.total ? p.available / p.total : 0;
  return r <= 0 ? 'out' : r < 0.3 ? 'low' : 'ok';
}
function Meter({ p }: { p: { available: number; total: number } }) {
  return (
    <span
      className={`meter meter-${stockLevel(p)}`}
      role="img"
      aria-label={`${p.available} of ${p.total} available`}
    >
      <i style={{ width: `${p.total ? (p.available / p.total) * 100 : 0}%` }} />
    </span>
  );
}
function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = requestAnimationFrame(() => setN(value));
      return () => cancelAnimationFrame(frame);
    }
    let raf = 0;
    const t0 =
      performance.now() +
      (document.documentElement.classList.contains('seen') ? 0 : 1800);
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 900));
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}
export default function TrackerApp({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => void;
}) {
  const visitedPages = useRef<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const role: Role = account.role;
  const bellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [repLedger, setRepLedger] = useState<RepEntry[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [serverNotifications, setServerNotifications] = useState<
    ServerNotification[]
  >([]);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    title: string;
  } | null>(null);
  const [review, setReview] = useState<{
    id: string;
    kind: 'request' | 'donation' | 'lending offer';
    approved: boolean;
    description: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [textDialog, setTextDialog] = useState<{
    kind: 'achievement' | 'description';
    title: string;
    value: string;
  } | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [page, setPage] = useState(
    role === 'Secretary' ? 'Equipment' : 'Overview',
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All equipment');
  const [modal, setModal] = useState<
    'request' | 'add' | 'member' | 'contribute' | null
  >(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [toast, setToast] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [requestProduct, setRequestProduct] = useState('');
  const [requestQty, setRequestQty] = useState('1');
  const requestedItem = products.find((p) => p.id === requestProduct);
  const availableUnits = requestedItem?.available ?? 0;
  const requestLimit = Math.min(availableUnits, requestedItem?.cap ?? 0);
  const quantity = Number(requestQty);
  let quantityError = '';
  if (availableUnits === 0 || quantity > availableUnits)
    quantityError = 'Not enough quantity available.';
  else if (requestQty && (!/^\d+$/.test(requestQty) || quantity < 1))
    quantityError = 'Enter a whole number of at least 1.';
  else if (quantity > requestLimit)
    quantityError = 'You can request up to ' + requestLimit + ' for this item.';
  const [purpose, setPurpose] = useState('');
  const [projectDeadline, setProjectDeadline] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Sensors');
  const [newStock, setNewStock] = useState(1);
  const [newImage, setNewImage] = useState('/products/placeholder.svg');
  const [newProductViews, setNewProductViews] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [acceptedContributionPoints, setContributionPoints] = useState(0);
  const [donations, setDonations] = useState<
    {
      id: string;
      memberId: string;
      member: string;
      kind: 'Donation' | 'Lend';
      item: string;
      detail: string;
      status: 'Pending' | 'Accepted' | 'Rejected';
      points: number;
      at: string;
      lendingUntil?: string;
      image?: string;
      reviewedBy?: string;
      rejectionReason?: string;
    }[]
  >([]);
  const [profileMember, setProfileMember] = useState<Member | null>(null);
  const [newDescription, setNewDescription] = useState('');
  const [newCondition, setNewCondition] = useState('Good');
  const [viewRotation, setViewRotation] = useState(0);
  const [newDonationKind, setNewDonationKind] = useState<'Donation' | 'Lend'>(
    'Donation',
  );
  const [newDonationItem, setNewDonationItem] = useState('');
  const [newDonationDetail, setNewDonationDetail] = useState('');
  const [newDonationUntil, setNewDonationUntil] = useState('');
  const [newDonationImage, setNewDonationImage] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('All roles');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberTeam, setNewMemberTeam] = useState('');
  const [newMemberGrade, setNewMemberGrade] = useState('');
  const [reasonDialog, setReasonDialog] = useState<{
    member: Member;
    kind: 'rep' | 'custom' | 'kick' | 'suspend';
    points?: number;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonPoints, setReasonPoints] = useState('5');
  const [suspendDays, setSuspendDays] = useState('7');
  const [closing, setClosing] = useState(false);
  const [hi, setHi] = useState<{ pid: string; i: number } | null>(null);
  const [tip, setTip] = useState({ x: 0, w: 1 });
  const searchRef = useRef<HTMLInputElement>(null);
  const [uploadsPending, setUploadsPending] = useState(0);
  async function uploadEquipmentImage(file: File) {
    setUploadsPending((n) => n + 1);
    try {
      return await uploadPhoto(file);
    } finally {
      setUploadsPending((n) => n - 1);
    }
  }
  const saving = useRef(false);
  const [loadError, setLoadError] = useState('');
  const [historyLimit, setHistoryLimit] = useState(100);
  const loadVersion = useRef(0);
  const invalidateLoads = useCallback(() => {
    loadVersion.current++;
  }, []);
  const refresh = useCallback(
    async function refresh(changed?: readonly string[]) {
      const version = ++loadVersion.current;
      const tasks: Promise<void>[] = [];
      function load<T>(
        view: string,
        apply: (data: T[]) => void,
        order = 'id',
        limit?: number,
      ) {
        if (changed && !changed.includes(view)) return;
        const memberId =
          view === 'requests' && role === 'Member' ? account.id : undefined;
        tasks.push(
          rows<T>(view, order, limit, memberId).then((data) => {
            if (version === loadVersion.current) apply(data);
          }),
        );
      }
      load<Product>('products', (data) => {
        setProducts(data);
        setSelected((old) => data.find((p) => p.id === old?.id) || null);
      });
      load<Request>('requests', setRequests, 'date');
      load<Member>('members', (data) => {
        setMembers(data);
        setProfileMember((old) => data.find((m) => m.id === old?.id) || null);
      });
      load<{ points: number }>(
        'contribution_total',
        (data) => setContributionPoints(data[0]?.points ?? 0),
        'id',
        1,
      );
      load<(typeof donations)[number]>('donations', setDonations, 'at');
      load<{ value: Preferences }>(
        'preferences',
        (data) => setPreferences({ ...DEFAULT_PREFS, ...data[0]?.value }),
        'key',
        1,
      );
      if (role !== 'Secretary' && role !== 'Member')
        load<ActivityEntry>('activity', setActivities, 'at', historyLimit);
      if (role !== 'Secretary')
        load<RepEntry>('reputation', setRepLedger, 'at', historyLimit);
      load<ServerNotification>(
        'notifications',
        setServerNotifications,
        'created_at',
        100,
      );
      await Promise.all(tasks);
      if (version === loadVersion.current) {
        setHydrated(true);
        setLoadError('');
      }
    },
    [role, historyLimit, account.id],
  );
  useEffect(() => {
    void refresh().catch((e) => setLoadError(e.message));
    return () => {
      invalidateLoads();
    };
  }, [refresh, invalidateLoads]);
  async function mutate(
    command: string,
    args: Record<string, unknown>,
    message: string,
    done?: () => void,
  ) {
    if (saving.current) return;
    if (uploadsPending) {
      notify('Please wait for the image upload to finish.');
      return;
    }
    saving.current = true;
    setDecisionBusy(true);
    try {
      const { error } = await getSupabase()!.rpc(command, args);
      if (error) throw new Error(error.message);
      done?.();
      notify(message);
      try {
        await refresh([
          ...(changedViews[command] || []),
          ...(command === 'read_notification' ? [] : ['activity']),
        ]);
      } catch {
        setLoadError('Change saved. Refresh to load the latest records.');
      }
    } catch (e) {
      notify('Error: ' + (e instanceof Error ? e.message : 'Could not save.'));
    } finally {
      saving.current = false;
      setDecisionBusy(false);
    }
  }
  useEffect(() => {
    try {
      sessionStorage.setItem('clublend-intro', '1');
    } catch {}
    const t = setTimeout(
      () => document.documentElement.classList.add('seen'),
      3400,
    );
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPage('Equipment');
        setTimeout(() => searchRef.current?.focus(), 80);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (visitedPages.current.has(page)) {
      setTransitionBusy(false);
      return;
    }
    setTransitionBusy(true);
    const currentPage = page;
    const timer = setTimeout(() => {
      visitedPages.current.add(currentPage);
      setTransitionBusy(false);
    }, 360);
    return () => clearTimeout(timer);
  }, [page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setImagePreview(null);
      if (saving.current) return;
      setReview(null);
      setReasonDialog(null);
      setTextDialog(null);
      setArchiveConfirm(false);
      setNotificationsOpen(false);
      setModal(null);
      setSelected(null);
      setProfileMember(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === 'All equipment' || p.category === category) &&
          `${p.name} ${p.code} ${p.category}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [products, category, query],
  );
  const categories = [
    'All equipment',
    ...Array.from(new Set(products.map((p) => p.category))),
  ];
  const totalUnits = products.reduce((a, p) => a + p.total, 0);
  const totalAvail = products.reduce((a, p) => a + p.available, 0);
  const hiP = hi ? products.find((p) => p.id === hi.pid) : undefined;
  const orbitIndex = selected?.views?.length
    ? Math.floor(
        ((((viewRotation % 360) + 360) % 360) / 360) * selected.views.length,
      )
    : 0;
  const [now] = useState(() => Date.now());
  const priorityScore = (r: Request) => {
    const rep = members.find((m) => m.id === r.memberId)?.rep || 0;
    const days = r.projectDeadline
      ? Math.ceil(
          (new Date(`${r.projectDeadline}T23:59:59`).getTime() - now) /
            86400000,
        )
      : 999;
    const urgency =
      days <= 3 ? 45 : days <= 7 ? 35 : days <= 14 ? 22 : days <= 30 ? 10 : 0;
    const competition = /competition|robofest|contest|tournament/i.test(
      r.purpose,
    )
      ? 12
      : 0;
    return Math.round(rep * 0.5 + urgency + competition);
  };
  const queue = (
    role === 'Member'
      ? requests.filter((r) => r.memberId === account.id)
      : requests.filter((r) => r.status === 'Pending')
  )
    .sort(
      (a, b) =>
        priorityScore(b) - priorityScore(a) ||
        Date.parse(a.date) - Date.parse(b.date),
    )
    .slice(0, 4);
  const lowStock = [...products]
    .filter((p) => stockLevel(p) !== 'ok')
    .sort((a, b) => a.available / a.total - b.available / b.total)
    .slice(0, 4);
  const dueSoon = requests
    .filter((r) => r.status === 'Approved')
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    .slice(0, 4);
  const pending = requests.filter((r) => r.status === 'Pending').length;
  const clubLevel = 1 + Math.floor(acceptedContributionPoints / 50);
  const milestoneProgress = Math.round(
    ((acceptedContributionPoints % 50) / 50) * 100,
  );
  const notificationItems = serverNotifications.map((n) => ({
    id: n.id,
    title: n.title,
    detail: n.body,
    kind: 'blue',
    at: n.created_at,
    actor: n.actor?.full_name,
    isRead: !!n.read_at,
  }));
  const unreadActivities = notificationItems.filter((a) => !a.isRead);
  const isSuper = role === 'Super Admin';
  const canAdmin = ['Super Admin', 'Admin'].includes(role);
  const canManage = ['Super Admin', 'Admin', 'Moderator'].includes(role);
  const canApprove = role !== 'Member';
  const canModerate = role !== 'Member';
  const isStaff = role !== 'Member';
  function notify(s: string) {
    setToast(s);
  }

  function changeReputation(member: Member, points: number) {
    setReasonDialog({ member, kind: 'rep', points });
    setReasonText('');
  }
  function adjustReputation(member: Member) {
    setReasonDialog({ member, kind: 'custom' });
    setReasonText('');
    setReasonPoints('');
  }
  function submitReasonAction() {
    if (!reasonDialog) return;
    const { kind, member, points } = reasonDialog;
    void mutate(
      'manage_member',
      {
        target: member.id,
        action: kind === 'custom' ? 'rep' : kind,
        reason: reasonText,
        points: kind === 'custom' ? Number(reasonPoints) : points,
        days: kind === 'suspend' ? Number(suspendDays) : undefined,
      },
      'Member updated.',
      () => setReasonDialog(null),
    );
  }
  function markNonReturn(r: Request) {
    if (confirm('Close this loan as lost and apply the non-return penalty?'))
      void mutate(
        'close_loan',
        { target: r.id, lost: true },
        'Non-return recorded.',
      );
  }
  function recordReturn(r: Request) {
    if (confirm('Confirm all equipment on this loan has been returned?'))
      void mutate('close_loan', { target: r.id }, 'Return recorded.');
  }
  function updatePreference(setting: keyof Preferences, amount: number) {
    if (amount === preferences[setting]) return;
    void mutate('set_preference', { setting, amount }, 'Preference saved.');
  }
  function submitReview() {
    if (!review || (!review.approved && !rejectReason.trim())) return;
    const request = review.kind === 'request';
    void mutate(
      request ? 'review_request' : 'review_contribution',
      {
        target: review.id,
        approved: review.approved,
        ...(!review.approved && { reason: rejectReason.trim() }),
      },
      review.approved
        ? request
          ? 'Request approved.'
          : 'Offer accepted.'
        : 'Rejection saved.',
      () => setReview(null),
    );
  }
  function closeReview() {
    if (!saving.current) setReview(null);
  }
  function saveTextDialog() {
    if (!textDialog) return;
    if (textDialog.kind === 'achievement' && profileMember)
      void mutate(
        'manage_member',
        {
          target: profileMember.id,
          action: 'achievement',
          reason: textDialog.value,
        },
        'Achievement saved.',
        () => setTextDialog(null),
      );
    if (textDialog.kind === 'description' && selected)
      void mutate(
        'save_equipment',
        { target: selected.id, changes: { description: textDialog.value } },
        'Description saved.',
        () => setTextDialog(null),
      );
  }
  function archiveSelected() {
    if (selected)
      void mutate(
        'save_equipment',
        { target: selected.id, changes: { active: false } },
        'Equipment archived.',
        () => {
          setArchiveConfirm(false);
          setSelected(null);
        },
      );
  }
  function closeAll() {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setModal(null);
      setSelected(null);
      setClosing(false);
    }, 200);
  }
  function glow(e: React.MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  function removeMember(id: string) {
    const member = members.find((m) => m.id === id);
    if (member) {
      setReasonText('');
      setReasonDialog({ member, kind: 'kick' });
    }
  }
  function suspendMember(id: string) {
    const member = members.find((m) => m.id === id);
    if (member) {
      setReasonText('');
      setReasonDialog({ member, kind: 'suspend' });
    }
  }
  function withdrawSanction(id: string) {
    if (confirm('Restore this membership?'))
      void mutate(
        'manage_member',
        { target: id, action: 'restore' },
        'Membership restored.',
      );
  }
  function exportRequests() {
    const rows = [
      [
        'Request ID',
        'Member',
        'Equipment',
        'Quantity',
        'Date submitted',
        'Due date',
        'Status',
        'Purpose',
      ],
      ...requests.map((r) => [
        String(r.id),
        r.member,
        r.product,
        String(r.qty),
        r.date,
        r.due,
        r.status,
        r.purpose,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((v) => `\"${v.replaceAll('\"', '\"\"')}\"`).join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'robohaven-requests.csv';
    a.click();
    URL.revokeObjectURL(url);
    notify('Request CSV exported.');
  }

  function openRequest(p?: Product) {
    setSelected(null);
    setRequestProduct(p?.id || products[0]?.id || '');
    setRequestQty('1');
    setPurpose('');
    setProjectDeadline('');
    setModal('request');
  }
  function submitRequest() {
    if (!requestQty || quantityError) return;
    void mutate(
      'submit_request',
      {
        product: requestProduct,
        quantity,
        purpose,
        deadline: projectDeadline || null,
      },
      'Request submitted.',
      () => setModal(null),
    );
  }
  function reviewRequest(r: Request, approved: boolean) {
    setRejectReason('');
    setReview({
      id: r.id,
      kind: 'request',
      approved,
      description: r.member + ' requested ' + r.qty + ' × ' + r.product + '.',
    });
  }
  function reviewOffer(d: (typeof donations)[number], approved: boolean) {
    setRejectReason('');
    setReview({
      id: d.id,
      kind: d.kind === 'Lend' ? 'lending offer' : 'donation',
      approved,
      description: d.member + ' offered ' + d.item + '.',
    });
  }
  function addProduct() {
    void mutate(
      'save_equipment',
      {
        target: null,
        changes: {
          name: newName,
          category: newCategory,
          description: newDescription,
          stock: newStock,
          condition: newCondition,
          image: newImage,
          views: newProductViews,
        },
      },
      'Equipment added.',
      () => {
        setModal(null);
        setNewName('');
        setNewDescription('');
        setNewStock(1);
        setNewProductViews([]);
      },
    );
  }
  useEffect(() => {
    if (!notificationsOpen) return;
    const down = (e: PointerEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node))
        setNotificationsOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [notificationsOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [menuOpen]);
  const guideMeta: Record<string, string> = {
    Equipment: `${products.length} products`,
    Requests: `${pending} pending`,
    'Loans & returns': 'Track returns',
    Members: `${members.length} members`,
    'Activity log': `${activities.length} events`,
    Settings: 'Admin & Moderator',
  };
  const navigation =
    role === 'Member'
      ? memberNav
      : staffNav.filter(
          ([label]) =>
            role !== 'Secretary' ||
            ['Equipment', 'Requests', 'Loans & returns'].includes(label),
        );
  const dialogCount = [
    modal,
    selected,
    profileMember,
    imagePreview,
    review,
    reasonDialog,
    textDialog,
    archiveConfirm,
  ].filter(Boolean).length;
  useEffect(() => {
    if (!dialogCount) return;
    const panel = Array.from(
      document.querySelectorAll<HTMLElement>('.modal-backdrop > div'),
    ).at(-1);
    if (!panel) return;
    const previous = document.activeElement;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute(
      'aria-label',
      panel.querySelector('h2')?.textContent || 'Club workspace dialog',
    );
    const controls = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      );
    controls()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = controls();
      const edge = e.shiftKey ? nodes[0] : nodes.at(-1);
      if (document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    };
    panel.addEventListener('keydown', trap);
    return () => {
      panel.removeEventListener('keydown', trap);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [dialogCount]);
  const lastFocus = useRef(0);
  useEffect(() => {
    const update = () => {
      if (
        !document.hidden &&
        !saving.current &&
        Date.now() - lastFocus.current > 20000
      ) {
        lastFocus.current = Date.now();
        void refresh().catch((e) => setLoadError(e.message));
      }
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [refresh]);
  const displayName =
    members.find((m) => m.id === account.id)?.name || account.name;
  const pageTitle =
    page === 'Overview'
      ? role === 'Member'
        ? 'Your workspace'
        : 'Club overview'
      : page;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Command size={20} />
          </div>
          <div>
            <b>RoboHaven</b>
            <span>Robotics club</span>
          </div>
          <button
            className="icon-btn mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav>
          <span
            className="nav-pill"
            style={
              {
                '--idx': navigation.findIndex((n) => n[0] === page),
              } as React.CSSProperties
            }
          />
          {navigation.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${page === label ? 'active' : ''}`}
              onClick={() => {
                if (label === 'Settings' && !canManage) {
                  notify('Settings are restricted to Admin and Moderator.');
                  return;
                }
                setPage(label);
                setMobileOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Requests' && pending > 0 && <i>{pending}</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="profile-avatar">{initials(displayName)}</div>
            <div className="profile-text">
              <b>{displayName}</b>
              <small>{role} account</small>
            </div>
            <button
              className="logout-btn"
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon-btn mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              Workspace <ChevronRight size={14} /> <b>{page}</b>
            </div>
          </div>
          <div className="top-actions">
            <div
              className="role-select"
              title={`Viewing the workspace as ${role}`}
              aria-label={`Viewing the workspace as ${role}`}
            >
              <Eye size={18} aria-hidden="true" />
              <b className="role-chip">{role}</b>
            </div>
            <div className="notification-wrap" ref={bellRef}>
              <button
                className="icon-btn notification"
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen);
                  setMenuOpen(false);
                  if (!notificationsOpen)
                    void rows<ServerNotification>(
                      'notifications',
                      'created_at',
                      100,
                    )
                      .then(setServerNotifications)
                      .catch(() => notify('Could not load notifications.'));
                }}
              >
                <Bell size={18} />
                {unreadActivities.length > 0 && <i />}
              </button>
              {notificationsOpen && (
                <div
                  className="notification-popover"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <div className="notification-head">
                    <b>Notifications</b>
                    <span>
                      {unreadActivities.length
                        ? `${unreadActivities.length} unread`
                        : 'All read'}
                    </span>
                  </div>
                  {notificationItems.length ? (
                    notificationItems.map((a) => (
                      <button
                        className={`notification-item ${a.isRead ? 'is-read' : ''}`}
                        key={a.id}
                        onClick={() => {
                          if (!a.isRead)
                            void mutate(
                              'read_notification',
                              { target: a.id },
                              'Marked as read.',
                            );
                        }}
                      >
                        <span className={`activity-dot ${a.kind}`} />
                        <span>
                          <b>{a.title}</b>
                          <small>{a.detail}</small>
                          <time>
                            {a.actor ? `By ${a.actor} · ` : ''}
                            {new Date(a.at).toLocaleString()}
                          </time>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="notification-empty">
                      <Bell size={20} />
                      <b>No notifications yet</b>
                      <span>New activity and decisions will appear here.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="account-wrap" ref={menuRef}>
              <button
                className="top-avatar"
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  setMenuOpen((v) => !v);
                  setNotificationsOpen(false);
                }}
              >
                {initials(displayName)}
              </button>
              {menuOpen && (
                <div className="account-menu" role="menu" aria-label="Account">
                  <div className="account-head">
                    <div className="account-avatar">
                      {initials(displayName)}
                    </div>
                    <div>
                      <b>{displayName}</b>
                      <small>
                        <Mail size={12} /> {account.email}
                      </small>
                    </div>
                  </div>
                  <span className="account-role">
                    <BadgeCheck size={14} /> {role} access
                  </span>
                  <div className="account-links">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setPage(
                          role === 'Secretary' ? 'Equipment' : 'Overview',
                        );
                        setMenuOpen(false);
                      }}
                    >
                      <LayoutDashboard size={16} /> My workspace
                    </button>
                    {canManage && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setPage('Activity log');
                          setMenuOpen(false);
                        }}
                      >
                        <Activity size={16} /> Activity log
                      </button>
                    )}
                    {canManage && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setPage('Settings');
                          setMenuOpen(false);
                        }}
                      >
                        <Settings size={16} /> Settings
                      </button>
                    )}
                  </div>
                  <button
                    role="menuitem"
                    className="account-out"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <h1 key={pageTitle} className="title-in">
                {pageTitle}
              </h1>
              <p>
                {page === 'Overview'
                  ? role === 'Member'
                    ? 'Your personal requests, reputation and club participation.'
                    : 'A clear view of equipment, activity and what needs attention.'
                  : page === 'Equipment'
                    ? 'Explore the club collection and keep every component accounted for.'
                    : page === 'Requests'
                      ? 'Review borrowing requests and keep projects moving.'
                      : page === 'Loans & returns'
                        ? 'Track active loans, due dates and returned equipment.'
                        : page === 'Members'
                          ? 'Keep club access and member standing organised.'
                          : page === 'Activity log'
                            ? 'A traceable record of changes across the equipment library.'
                            : page === 'Donation / Lend'
                              ? 'Support the next build with a donation or equipment loan.'
                              : 'Manage workspace preferences and access.'}
              </p>
            </div>
            <div className="heading-actions">
              {isStaff && (
                <button
                  className="button button-quiet"
                  onClick={exportRequests}
                >
                  <Download size={16} /> Export
                </button>
              )}

              {page === 'Members' && (
                <button
                  className="button button-primary"
                  onClick={() => {
                    const me = members.find((m) => m.id === account.id);
                    setNewMemberName(me?.name || displayName);
                    setNewMemberTeam(me?.team || '');
                    setNewMemberGrade(me?.grade || '');
                    setModal('member');
                  }}
                >
                  <Plus size={17} /> Edit my profile
                </button>
              )}
              {canModerate && page === 'Equipment' && (
                <button
                  className="button button-primary"
                  onClick={() => setModal('add')}
                >
                  <Plus size={17} /> Add equipment
                </button>
              )}
              {role === 'Member' &&
                ['Overview', 'Equipment'].includes(page) && (
                  <button
                    className="button button-primary"
                    onClick={() => openRequest()}
                  >
                    <Plus size={17} /> New request
                  </button>
                )}
            </div>
          </div>
          {loadError && (
            <div role="alert">
              {loadError}{' '}
              <button
                onClick={() =>
                  void refresh().catch((e) => setLoadError(e.message))
                }
              >
                Retry
              </button>
            </div>
          )}
          <div key={page} className="page-view">
            {(!hydrated || transitionBusy || decisionBusy) && (
              <div
                className="workspace-loading"
                role="status"
                aria-label="Loading workspace"
              >
                <div className="skeleton skeleton-heading" />
                <div className="skeleton skeleton-subheading" />
                <div className="skeleton-grid">
                  <div className="skeleton skeleton-card" />
                  <div className="skeleton skeleton-card" />
                  <div className="skeleton skeleton-card" />
                </div>
              </div>
            )}
            {page === 'Overview' && (
              <>
                {role === 'Member' ? (
                  <section className="member-home panel">
                    <div className="member-home-copy">
                      <span className="eyebrow">YOUR PRIVATE STATUS</span>
                      <h2>Welcome back, {displayName.split(' ')[0]}.</h2>
                      <p>
                        Only your own requests, loans and reputation are shown
                        here.
                      </p>
                      <div className="member-home-stats">
                        <div>
                          <b>
                            {
                              requests.filter(
                                (r) =>
                                  r.memberId === account.id &&
                                  r.status === 'Pending',
                              ).length
                            }
                          </b>
                          <span>Your pending requests</span>
                        </div>
                        <div>
                          <b>
                            {
                              requests.filter(
                                (r) =>
                                  r.memberId === account.id &&
                                  r.status === 'Approved',
                              ).length
                            }
                          </b>
                          <span>Your active loans</span>
                        </div>
                        <div>
                          <b>
                            {members.find((m) => m.id === account.id)?.rep || 0}
                          </b>
                          <span>Your reputation</span>
                        </div>
                      </div>
                      <div className="personal-status-list">
                        {requests
                          .filter((r) => r.memberId === account.id)
                          .slice(0, 3)
                          .map((r) => (
                            <div className="ov-row" key={r.id}>
                              <div className="request-avatar">
                                {initials(displayName)}
                              </div>
                              <div className="ov-main">
                                <b>{r.product}</b>
                                <span>
                                  Qty {r.qty} · Due {r.due}
                                </span>
                              </div>
                              <Status status={r.status} />
                            </div>
                          ))}
                        {!requests.some((r) => r.memberId === account.id) && (
                          <div className="ov-empty">
                            <b>No requests yet</b>
                            <span>
                              Your personal request status will appear here.
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        className="button button-primary"
                        onClick={() => openRequest()}
                      >
                        <Plus size={16} /> Request equipment
                      </button>
                    </div>
                    <div className="member-home-art">
                      <Image
                        src="/robotics-donation-appeal.png"
                        alt="Robotics rover in the club workshop"
                        fill
                        sizes="360px"
                      />
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="stock-hero">
                      <div className="hero-main">
                        <span className="hero-label">
                          {hi && hiP
                            ? `${hiP.name} · unit ${hi.i + 1} of ${hiP.total} · ${hi.i < hiP.available ? 'on the shelf' : 'out on loan'}`
                            : 'On the shelf now'}
                        </span>
                        <div className="hero-figure">
                          <span className="hero-num">
                            <CountUp value={totalAvail} />
                          </span>
                          <span className="hero-of">
                            of {totalUnits} units
                            <br />
                            across {products.length} products
                          </span>
                        </div>
                      </div>
                      <div
                        className="ruler"
                        onMouseLeave={() => setHi(null)}
                        onMouseMove={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setTip({ x: e.clientX - r.left, w: r.width });
                        }}
                        role="group"
                        aria-label="Stock by product, one tick per unit"
                      >
                        {products.map((p, gi) => (
                          <button
                            key={p.id}
                            className={`rgroup ${hi && hi.pid !== p.id ? 'dim' : ''}`}
                            style={
                              {
                                flex: p.total,
                                '--g': gi,
                              } as React.CSSProperties
                            }
                            onClick={() => {
                              setHi(null);
                              setSelected(p);
                              setPage('Equipment');
                            }}
                            onFocus={(e) => {
                              setHi({ pid: p.id, i: 0 });
                              setTip({
                                x:
                                  e.currentTarget.offsetLeft +
                                  e.currentTarget.offsetWidth / 2,
                                w:
                                  e.currentTarget.parentElement?.clientWidth ||
                                  1,
                              });
                            }}
                            onBlur={() => setHi(null)}
                            aria-label={`${p.name}: ${p.available} of ${p.total} available, condition ${p.condition}. Open in equipment`}
                          >
                            {Array.from(
                              { length: Math.min(p.total, 40) },
                              (_, i) => (
                                <i
                                  key={i}
                                  className={
                                    i <
                                    Math.round(
                                      (p.available / Math.max(p.total, 1)) *
                                        Math.min(p.total, 40),
                                    )
                                      ? 'on'
                                      : ''
                                  }
                                  onMouseEnter={() => setHi({ pid: p.id, i })}
                                  style={
                                    {
                                      '--i': i,
                                      '--g': gi,
                                      ...(hi && hi.pid === p.id
                                        ? {
                                            transform: `scaleY(${1 + Math.max(0, 1 - Math.abs(i - hi.i) / 5) * 0.45})`,
                                          }
                                        : {}),
                                    } as React.CSSProperties
                                  }
                                />
                              ),
                            )}
                          </button>
                        ))}
                        {hiP && (
                          <div
                            className={`tip ${tip.x > tip.w / 2 ? 'tip-l' : 'tip-r'}`}
                            style={{ left: tip.x }}
                            aria-hidden="true"
                          >
                            <div className="tip-in" key={hiP.id}>
                              <div className="tip-img">
                                <Image
                                  unoptimized
                                  src={hiP.image}
                                  alt=""
                                  fill
                                  sizes="110px"
                                />
                              </div>
                              <div className="tip-body">
                                <small>
                                  {hiP.category} · {hiP.code}
                                </small>
                                <b>{hiP.name}</b>
                                <div className="tip-count">
                                  <strong>{hiP.available}</strong>
                                  <span>of {hiP.total} available</span>
                                </div>
                                <span className="tip-meter">
                                  <u
                                    style={{
                                      width: `${hiP.total ? (hiP.available / hiP.total) * 100 : 0}%`,
                                    }}
                                  />
                                </span>
                                <div className="tip-row">
                                  <span
                                    className={`tip-state s-${stockLevel(hiP)}`}
                                  >
                                    {stockLevel(hiP) === 'out'
                                      ? 'All out on loan'
                                      : stockLevel(hiP) === 'low'
                                        ? 'Running low'
                                        : 'Ready to lend'}
                                  </span>
                                  <span className="tip-cond">
                                    Condition: {hiP.condition}
                                  </span>
                                </div>
                                <em>
                                  Up to {hiP.cap} per request · click to open
                                </em>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="hero-side">
                        <button
                          className={`review-chip ${pending ? 'has-pending' : ''}`}
                          onClick={() => setPage('Requests')}
                        >
                          <b>{pending}</b>
                          <span>
                            {pending === 1
                              ? 'request waiting'
                              : 'requests waiting'}{' '}
                            for review
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                        <div className="hero-meta">
                          <span>
                            <b>{categories.length - 1}</b> categories
                          </span>
                          <span>
                            <b>{totalUnits - totalAvail}</b> units out on loan
                          </span>
                        </div>
                      </div>
                    </section>
                    <section
                      className="guide"
                      aria-label="Where to find things"
                    >
                      <div className="guide-head">
                        <h3>Find your way around</h3>
                        <span>Tap a card to jump straight in</span>
                      </div>
                      <div className="guide-grid">
                        {guide
                          .filter(([g]) => g !== 'Settings' || canManage)
                          .map(([g, Icon, blurb], i) => (
                            <button
                              key={g}
                              className={`guide-card ${g === 'Requests' && pending > 0 ? 'hot' : ''}`}
                              style={{ '--i': i } as React.CSSProperties}
                              onMouseMove={glow}
                              onClick={() => setPage(g)}
                            >
                              <span className="guide-icon">
                                <Icon size={18} />
                              </span>
                              <span className="guide-copy">
                                <b>{g}</b>
                                <small>{blurb}</small>
                              </span>
                              <em>{guideMeta[g]}</em>
                              <ChevronRight size={16} className="guide-go" />
                            </button>
                          ))}
                      </div>
                    </section>
                    <div className="ov-cols">
                      <section className="ov-col">
                        <div className="ov-head">
                          <h3>
                            {'Waiting for you'}
                            {queue.length > 0 && (
                              <span className="ov-count">{queue.length}</span>
                            )}
                          </h3>
                          <button
                            className="text-link"
                            onClick={() => setPage('Requests')}
                          >
                            All requests <ArrowUpRight size={15} />
                          </button>
                        </div>
                        {queue.length ? (
                          queue.map((r) => (
                            <div className="ov-row" key={r.id}>
                              <div className="request-avatar">
                                {initials(r.member)}
                              </div>
                              <div className="ov-main">
                                <b>{r.member}</b>
                                <span>
                                  {r.product} · Qty {r.qty}
                                </span>
                                <small>
                                  Due {r.due}, {dueIn(r.due)}
                                </small>
                              </div>
                              {r.status === 'Pending' && canApprove ? (
                                <div className="inline-actions">
                                  <button
                                    className="approve-btn"
                                    onClick={() => reviewRequest(r, true)}
                                    aria-label={`Approve request ${r.id}`}
                                  >
                                    <Check size={15} />
                                  </button>
                                  <button
                                    className="reject-btn"
                                    onClick={() => reviewRequest(r, false)}
                                    aria-label={`Reject request ${r.id}`}
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              ) : (
                                <Status status={r.status} />
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="ov-empty">
                            <b>All clear</b>
                            <span>{'No requests are waiting for review.'}</span>
                          </div>
                        )}
                      </section>
                      <section className="ov-col">
                        <div className="ov-head">
                          <h3>
                            Running low
                            {lowStock.length > 0 && (
                              <span className="ov-count">
                                {lowStock.length}
                              </span>
                            )}
                          </h3>
                          <button
                            className="text-link"
                            onClick={() => setPage('Equipment')}
                          >
                            Equipment <ArrowUpRight size={15} />
                          </button>
                        </div>
                        {lowStock.length ? (
                          lowStock.map((p) => (
                            <button
                              className="ov-row ov-link"
                              key={p.id}
                              onClick={() => {
                                setSelected(p);
                                setPage('Equipment');
                              }}
                            >
                              <div className="mini-image">
                                <Image
                                  unoptimized
                                  onError={(e) => {
                                    e.currentTarget.srcset = '';
                                    e.currentTarget.src =
                                      '/products/placeholder.svg';
                                  }}
                                  src={p.image}
                                  alt={p.name}
                                  fill
                                  sizes="64px"
                                />
                              </div>
                              <div className="ov-main">
                                <b>{p.name}</b>
                                <span>
                                  {p.available} of {p.total} available
                                </span>
                                <Meter p={p} />
                              </div>
                              <ChevronRight size={16} />
                            </button>
                          ))
                        ) : (
                          <div className="ov-empty">
                            <b>Well stocked</b>
                            <span>Every product has plenty on the shelf.</span>
                          </div>
                        )}
                      </section>
                      <section className="ov-col">
                        <div className="ov-head">
                          <h3>
                            Due back soon
                            {dueSoon.length > 0 && (
                              <span className="ov-count">{dueSoon.length}</span>
                            )}
                          </h3>
                          <button
                            className="text-link"
                            onClick={() => setPage('Loans & returns')}
                          >
                            All loans <ArrowUpRight size={15} />
                          </button>
                        </div>
                        {dueSoon.length ? (
                          dueSoon.map((r) => (
                            <div className="ov-row" key={r.id}>
                              <div className="request-avatar">
                                {initials(r.member)}
                              </div>
                              <div className="ov-main">
                                <b>{r.product}</b>
                                <span>
                                  {r.member} · Qty {r.qty}
                                </span>
                                <small>
                                  {r.due}, {dueIn(r.due)}
                                </small>
                              </div>
                              {canApprove && (
                                <button
                                  className="button button-quiet button-small"
                                  onClick={() => recordReturn(r)}
                                >
                                  Record return
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="ov-empty">
                            <b>Nothing on loan</b>
                            <span>
                              Approved requests will appear here until returned.
                            </span>
                          </div>
                        )}
                      </section>
                    </div>
                  </>
                )}
              </>
            )}
            {page === 'Equipment' && (
              <>
                <div className="toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      ref={searchRef}
                      placeholder="Search equipment, category or asset ID…"
                      aria-label="Search equipment"
                    />
                    <kbd>Ctrl/⌘ K</kbd>
                  </div>
                  <div className="toolbar-right">
                    <div className="select-wrap">
                      <Filter size={15} />
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        aria-label="Filter by category"
                      >
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <span className="result-count">
                      {filtered.length} items
                    </span>
                  </div>
                </div>
                <div className="equipment-grid">
                  {filtered.map((p, i) => (
                    <article
                      className="equipment-card"
                      key={p.id}
                      style={{ '--i': i } as React.CSSProperties}
                    >
                      <button
                        className="product-visual"
                        onMouseMove={glow}
                        onClick={() => setSelected(p)}
                        aria-label={`View ${p.name} details`}
                      >
                        <Image
                          unoptimized
                          onError={(e) => {
                            e.currentTarget.srcset = '';
                            e.currentTarget.src = '/products/placeholder.svg';
                          }}
                          src={p.image}
                          alt={p.name}
                          fill
                          sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 25vw"
                        />
                        <span className="stock-pill">
                          <i
                            className={p.available ? 'in-stock' : 'out-stock'}
                          />
                          {p.available
                            ? stockLevel(p) === 'low'
                              ? 'Low stock'
                              : 'Available'
                            : 'All out'}
                        </span>
                        <span className="product-arrow">
                          <ArrowUpRight size={17} />
                        </span>
                      </button>
                      <div className="product-meta">
                        <span>{p.category}</span>
                        <span className="mono">{p.code}</span>
                      </div>
                      <h3>{p.name}</h3>
                      <Meter p={p} />
                      <div className="product-footer">
                        <div>
                          <b>{p.available}</b>
                          <span> / {p.total} available</span>
                        </div>
                        <button
                          className="button button-small button-primary"
                          onClick={() =>
                            role === 'Member' ? openRequest(p) : setSelected(p)
                          }
                        >
                          {role === 'Member' ? 'Request' : 'Details'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <Empty
                    title="No equipment found"
                    body="Try a different search or category filter."
                    action={() => {
                      setQuery('');
                      setCategory('All equipment');
                    }}
                  />
                )}
              </>
            )}
            {page === 'Donation / Lend' && role === 'Member' && (
              <div className="donation-page">
                <section className="donation-hero panel">
                  <div className="donation-copy">
                    <span className="eyebrow">BUILD SOMETHING BIGGER</span>
                    <h2>Every contribution moves the club forward.</h2>
                    <p>
                      Help RoboHaven reach its next workshop milestone. Donate
                      spare components or lend equipment your team can share.
                      Accepted contributions earn reputation and become part of
                      your robotics legacy.
                    </p>
                    <div className="milestone-track">
                      <div>
                        <b>Level {String(clubLevel).padStart(2, '0')}</b>
                        <span>
                          {clubLevel < 3
                            ? 'Workshop expansion'
                            : clubLevel < 6
                              ? 'Competition readiness'
                              : 'Advanced prototyping lab'}
                        </span>
                      </div>
                      <div className="milestone-bar">
                        <i style={{ width: `${milestoneProgress}%` }} />
                      </div>
                      <small>
                        {acceptedContributionPoints % 50} / 50 contribution
                        reputation toward the next level · accepted donation +5,
                        lend +3
                      </small>
                    </div>
                    <button
                      className="button button-primary"
                      onClick={() => {
                        setNewDonationKind('Donation');
                        setNewDonationItem('');
                        setNewDonationDetail('');
                        setNewDonationUntil('');
                        setNewDonationImage('');
                        setModal('contribute');
                      }}
                    >
                      <HandHeart size={17} /> Contribute equipment
                    </button>
                  </div>
                  <div className="donation-art">
                    <Image
                      src="/robotics-donation-appeal.png"
                      alt="Robotics rover and components in a maker lab"
                      fill
                      sizes="520px"
                    />
                  </div>
                </section>
                <section className="donation-options">
                  <article className="panel">
                    <HandHeart />
                    <h3>Donate an item</h3>
                    <p>
                      Give components or tools to the club permanently. Accepted
                      donations earn lasting reputation.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => {
                        setNewDonationKind('Donation');
                        setNewDonationUntil('');
                        setNewDonationImage('');
                        setModal('contribute');
                      }}
                    >
                      Offer a donation <ArrowUpRight size={15} />
                    </button>
                  </article>
                  <article className="panel">
                    <Boxes />
                    <h3>Lend to the club</h3>
                    <p>
                      Temporarily share a component for a build or competition.
                      Your item remains attributed to you.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => {
                        setNewDonationKind('Lend');
                        setNewDonationUntil('');
                        setNewDonationImage('');
                        setModal('contribute');
                      }}
                    >
                      Lend equipment <ArrowUpRight size={15} />
                    </button>
                  </article>
                </section>
                <section className="panel table-panel">
                  <h3>Your contributions</h3>
                  {donations.filter((d) => d.memberId === account.id).length ? (
                    donations
                      .filter((d) => d.memberId === account.id)
                      .map((d) => (
                        <div className="activity-row" key={d.id}>
                          <span className="activity-dot green" />
                          <div>
                            <b>
                              {d.kind}: {d.item}
                            </b>
                            <p>{d.detail}</p>
                            <small>
                              {d.status}
                              {d.lendingUntil
                                ? ` · Return by ${d.lendingUntil}`
                                : ''}{' '}
                              ·{' '}
                              {d.points
                                ? `+${d.points} reputation when accepted`
                                : 'Awaiting review'}
                            </small>
                          </div>
                          <time>{new Date(d.at).toLocaleDateString()}</time>
                        </div>
                      ))
                  ) : (
                    <Empty
                      title="Your contribution story starts here"
                      body="Items you donate or lend will appear here with their review status."
                    />
                  )}
                </section>
              </div>
            )}
            {page === 'Requests' && (
              <section className="panel table-panel">
                <div className="panel-head">
                  <div>
                    <h3>
                      {role === 'Member'
                        ? 'Your borrowing requests'
                        : 'Borrowing requests'}{' '}
                      <span className="count-badge">{requests.length}</span>
                    </h3>
                  </div>
                  <div className="table-actions">
                    <button
                      className="button button-quiet button-small"
                      onClick={exportRequests}
                    >
                      Export requests
                    </button>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Member</th>
                        <th>Equipment</th>
                        <th>Project / purpose</th>
                        <th>Priority</th>
                        <th>Due date</th>
                        <th>Status</th>
                        {canApprove && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...requests]
                        .sort(
                          (a, b) =>
                            priorityScore(b) - priorityScore(a) ||
                            Date.parse(a.date) - Date.parse(b.date),
                        )
                        .map((r) => (
                          <tr key={r.id}>
                            <td>
                              <b className="mono">#{r.id}</b>
                              <small>{r.date}</small>
                            </td>
                            <td>
                              <b>{r.member}</b>
                            </td>
                            <td>
                              {r.product}
                              <small>Quantity: {r.qty}</small>
                            </td>
                            <td>
                              {r.purpose}
                              {r.projectDeadline && (
                                <small>
                                  Project deadline:{' '}
                                  {new Date(
                                    `${r.projectDeadline}T00:00:00`,
                                  ).toLocaleDateString()}
                                </small>
                              )}
                            </td>
                            <td>
                              <span className="priority-score">
                                {priorityScore(r)} pts
                              </span>
                              <small>
                                {members.find((m) => m.id === r.memberId)
                                  ?.rep || 0}{' '}
                                reputation
                              </small>
                            </td>
                            <td>
                              {r.due}
                              <small>{dueIn(r.due)}</small>
                            </td>
                            <td>
                              <Status status={r.status} />
                            </td>
                            {canApprove && (
                              <td>
                                {r.status === 'Pending' ? (
                                  <div className="inline-actions">
                                    <button
                                      className="approve-btn"
                                      onClick={() => reviewRequest(r, true)}
                                      aria-label={`Approve request ${r.id}`}
                                    >
                                      <Check size={15} />
                                    </button>
                                    <button
                                      className="reject-btn"
                                      onClick={() => reviewRequest(r, false)}
                                      aria-label={`Reject request ${r.id}`}
                                    >
                                      <X size={15} />
                                    </button>
                                  </div>
                                ) : (
                                  <span className="muted">Reviewed</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {requests.length === 0 && (
                  <Empty
                    title="No requests yet"
                    body="New member requests will appear here."
                  />
                )}
                <p className="table-footnote">
                  Priority ranks requests using member reputation, declared
                  project deadline and competition urgency. It guides review
                  only; it never approves a request automatically.
                </p>
              </section>
            )}

            {page === 'Loans & returns' && (
              <section className="panel table-panel">
                <div className="panel-head">
                  <h3>
                    {role === 'Member'
                      ? 'Your loans and returns'
                      : 'Equipment loans'}
                  </h3>
                </div>
                {requests
                  .filter((r) =>
                    ['Approved', 'Returned', 'Non-return'].includes(r.status),
                  )
                  .map((r) => (
                    <div className="ov-row" key={r.id}>
                      <div className="ov-main">
                        <b>
                          {r.product} · {r.qty}
                        </b>
                        <span>
                          {r.member} · Due {r.due}
                        </span>
                        <small>
                          {r.status === 'Approved' ? dueIn(r.due) : r.status}
                        </small>
                      </div>
                      {r.status === 'Approved' && canApprove && (
                        <div className="inline-actions">
                          <button
                            className="button button-small"
                            onClick={() => recordReturn(r)}
                          >
                            Record return
                          </button>
                          <button
                            className="button button-small"
                            onClick={() => markNonReturn(r)}
                          >
                            Record loss
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                {!requests.some((r) =>
                  ['Approved', 'Returned', 'Non-return'].includes(r.status),
                ) && (
                  <Empty
                    title="No loans yet"
                    body="Approved borrowing requests appear here."
                  />
                )}
              </section>
            )}
            {page === 'Overview' && role === 'Member' && (
              <section className="panel table-panel">
                <h3>Your reputation history</h3>
                {repLedger.length ? (
                  repLedger.map((entry) => (
                    <div className="ledger-row" key={entry.id}>
                      <b>
                        {entry.points > 0 ? '+' : ''}
                        {entry.points}
                      </b>
                      <span>{entry.reason}</span>
                      <small>
                        {entry.actor} ·{' '}
                        {new Date(entry.at).toLocaleDateString()}
                      </small>
                    </div>
                  ))
                ) : (
                  <p>No reputation adjustments yet.</p>
                )}
              </section>
            )}
            {page === 'Members' && (
              <section className="panel table-panel">
                <div className="panel-head">
                  <h3>
                    Club members{' '}
                    <span className="count-badge">{members.length}</span>
                  </h3>
                  <div className="member-tools">
                    <select
                      className="member-role-filter"
                      value={memberRoleFilter}
                      onChange={(e) => setMemberRoleFilter(e.target.value)}
                      aria-label="Filter members by role"
                    >
                      {[
                        'All roles',
                        'Super Admin',
                        'Admin',
                        'Moderator',
                        'Secretary',
                        'Member',
                      ].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <div className="search-box member-search">
                      <Search size={16} />
                      <input
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        placeholder="Search by name or team"
                        aria-label="Search members"
                      />
                    </div>
                  </div>
                </div>
                <div className="member-grid">
                  {[...members]
                    .filter(
                      (m) =>
                        (memberRoleFilter === 'All roles' ||
                          (m.role || 'Member') === memberRoleFilter) &&
                        `${m.name} ${m.team}`
                          .toLowerCase()
                          .includes(memberQuery.toLowerCase()),
                    )
                    .sort((a, b) => b.rep - a.rep)
                    .map((m, i) => (
                      <div
                        className="member-card member-card-button"
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setProfileMember(m)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            setProfileMember(m);
                        }}
                        style={{ '--i': i } as React.CSSProperties}
                      >
                        <div
                          className={`member-avatar sanction-avatar ${m.status === 'banned' ? 'is-kicked' : m.status === 'suspended' && (!m.suspendedUntil || Date.parse(m.suspendedUntil) > now) ? 'is-suspended' : ''}`}
                        >
                          {m.avatar ? (
                            <Image
                              unoptimized
                              src={m.avatar}
                              alt={`${m.name} profile portrait`}
                              fill
                              sizes="56px"
                            />
                          ) : (
                            initials(m.name)
                          )}
                          {m.status &&
                            m.status !== 'active' &&
                            !(
                              m.status === 'suspended' &&
                              m.suspendedUntil &&
                              Date.parse(m.suspendedUntil) <= now
                            ) && (
                              <span className="sanction-stamp">
                                {m.status === 'banned' ? 'KICKED' : 'SUSPENDED'}
                              </span>
                            )}
                        </div>
                        <div>
                          <b>{m.name}</b>
                          <span>
                            {m.team}
                            {m.role && m.role !== 'Member'
                              ? ` · ${m.role}`
                              : ''}
                          </span>
                        </div>
                        <div
                          className="rep-ring"
                          style={
                            {
                              '--p': Math.max(0, Math.min(100, m.rep)),
                            } as React.CSSProperties
                          }
                          role="img"
                          aria-label={`Reputation ${m.rep}`}
                        >
                          <b>{m.rep}</b>
                        </div>
                        {canManage &&
                          m.id !== account.id &&
                          m.role !== 'Super Admin' &&
                          (isSuper || m.role !== 'Admin') && (
                            <div
                              className="rep-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canAdmin &&
                                m.role === 'Member' &&
                                m.status === 'active' && (
                                  <label className="member-promotion">
                                    Promote to
                                    <select
                                      aria-label={'Promote ' + m.name}
                                      value=""
                                      disabled={decisionBusy}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        if (
                                          next &&
                                          confirm(
                                            'Promote ' +
                                              m.name +
                                              ' to ' +
                                              next +
                                              '?',
                                          )
                                        )
                                          void mutate(
                                            'promote_member',
                                            {
                                              target: m.id,
                                              staff_role: next.toLowerCase(),
                                            },
                                            'Member promoted.',
                                          );
                                      }}
                                    >
                                      <option value="">Select role</option>
                                      {['Secretary', 'Moderator', 'Admin'].map(
                                        (r) => (
                                          <option key={r}>{r}</option>
                                        ),
                                      )}
                                    </select>
                                  </label>
                                )}
                              <button
                                onClick={() => changeReputation(m, 5)}
                                aria-label={`Add 5 reputation to ${m.name}`}
                              >
                                +5
                              </button>
                              <button
                                onClick={() => changeReputation(m, -5)}
                                aria-label={`Deduct 5 reputation from ${m.name}`}
                              >
                                −5
                              </button>
                              <button
                                onClick={() => adjustReputation(m)}
                                aria-label={`Adjust reputation for ${m.name}`}
                              >
                                Adjust
                              </button>
                              {canAdmin &&
                                (m.status === 'banned' ||
                                (m.status === 'suspended' &&
                                  (!m.suspendedUntil ||
                                    Date.parse(m.suspendedUntil) > now)) ? (
                                  <button
                                    className="withdraw-sanction"
                                    onClick={() => withdrawSanction(m.id)}
                                    aria-label={`Withdraw sanction for ${m.name}`}
                                  >
                                    Withdraw
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => suspendMember(m.id)}
                                      aria-label={`Suspend ${m.name}`}
                                    >
                                      <Clock3 size={13} />
                                    </button>
                                    <button
                                      onClick={() => removeMember(m.id)}
                                      aria-label={`Kick ${m.name}`}
                                    >
                                      <Ban size={13} />
                                    </button>
                                  </>
                                ))}
                            </div>
                          )}
                      </div>
                    ))}
                </div>
                {members.filter(
                  (m) =>
                    (memberRoleFilter === 'All roles' ||
                      (m.role || 'Member') === memberRoleFilter) &&
                    `${m.name} ${m.team}`
                      .toLowerCase()
                      .includes(memberQuery.toLowerCase()),
                ).length === 0 && (
                  <Empty
                    title={
                      members.length ? 'No members match' : 'No members yet'
                    }
                    body={
                      members.length
                        ? 'Try a different name or team.'
                        : 'Members appear here after registration.'
                    }
                    action={
                      members.length ? () => setMemberQuery('') : undefined
                    }
                  />
                )}
                <p className="table-footnote">
                  Every member starts at 0. Approved on-time returns earn
                  points, late returns and non-returns deduct points, and
                  approved donations earn points based on value. Admin
                  adjustments require a reason and are recorded.
                </p>
                <div className="member-ledger">
                  <div className="panel-head">
                    <h3>Reputation history</h3>
                    <span className="count-badge">{repLedger.length}</span>
                  </div>
                  {canAdmin && repLedger.length ? (
                    repLedger.slice(0, 8).map((e) => (
                      <div className="ledger-row" key={e.id}>
                        <b>{e.member}</b>
                        <span>{e.reason}</span>
                        <strong
                          className={e.points > 0 ? 'positive' : 'negative'}
                        >
                          {e.points > 0 ? '+' : ''}
                          {e.points}
                        </strong>
                        <small>
                          {new Date(e.at).toLocaleString()} · changed by{' '}
                          {e.actor}
                        </small>
                      </div>
                    ))
                  ) : canAdmin ? (
                    <p className="table-footnote">
                      No reputation activity yet. Each change will be recorded
                      here.
                    </p>
                  ) : null}
                </div>
              </section>
            )}
            {page === 'Requests' && canApprove && (
              <section className="panel table-panel contribution-review">
                <h3>
                  Donation & lending offers{' '}
                  <span className="count-badge">
                    {donations.filter((d) => d.status === 'Pending').length}
                  </span>
                </h3>
                {donations.length ? (
                  donations.map((d) => (
                    <div className="activity-row" key={d.id}>
                      <span className="activity-dot gold" />
                      <div>
                        <b>
                          {d.kind}: {d.item}
                        </b>
                        <p>
                          {d.member} · {d.detail}
                        </p>
                        {d.image && (
                          <div className="contribution-image-preview">
                            {d.image.split('|').map((src, i) => (
                              <button
                                type="button"
                                className="contribution-image-button"
                                key={src + i}
                                onClick={() =>
                                  setImagePreview({ src, title: d.item })
                                }
                                aria-label={`View ${d.item} photograph ${i + 1}`}
                              >
                                <Image
                                  unoptimized
                                  src={src}
                                  alt={`${d.item} photograph ${i + 1}`}
                                  width={92}
                                  height={70}
                                />
                                <span>
                                  <Eye size={13} /> View
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        <small>
                          {d.status}
                          {d.lendingUntil
                            ? ` · Return by ${d.lendingUntil}`
                            : ''}
                          {d.reviewedBy ? ` · reviewed by ${d.reviewedBy}` : ''}
                          {d.rejectionReason
                            ? ` · Reason: ${d.rejectionReason}`
                            : ''}
                        </small>
                      </div>
                      {d.status === 'Pending' && canAdmin && (
                        <div className="inline-actions">
                          <button
                            className="approve-btn"
                            onClick={() => reviewOffer(d, true)}
                            aria-label={`Approve ${d.item}`}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="reject-btn"
                            onClick={() => reviewOffer(d, false)}
                            aria-label={`Reject ${d.item}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <Empty
                    title="No contribution offers"
                    body="Member donation and lending offers will appear here for review."
                  />
                )}
              </section>
            )}
            {page === 'Activity log' && isStaff && (
              <section className="panel activity-panel">
                <div className="panel-head">
                  <div>
                    <h3>
                      Workspace activity{' '}
                      <span className="count-badge">{activities.length}</span>
                    </h3>
                    <p className="table-footnote">
                      Recent club actions, recorded with their actor and
                      timestamp.
                    </p>
                  </div>
                </div>
                {activities.length ? (
                  activities.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <span className={`activity-dot ${a.kind}`} />
                      <div>
                        <b>{a.title}</b>
                        <p>{a.detail}</p>
                        {a.actor && (
                          <small className="activity-actor">
                            Action by {a.actor}
                          </small>
                        )}
                      </div>
                      <time>{new Date(a.at).toLocaleString()}</time>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="No activity recorded yet"
                    body="Request submissions, approvals, returns, member changes and reputation updates will appear here as they happen."
                  />
                )}
              </section>
            )}
            {page === 'Settings' && canManage && (
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <h3>Club preferences</h3>
                  <p className="settings-intro">
                    Changes are saved to the club database and affect new
                    requests immediately.
                  </p>
                  <div className="setting-line">
                    <div>
                      <b>Borrowing period</b>
                      <p>Default loan duration, in days</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="90"
                      key={preferences.borrowDays}
                      defaultValue={preferences.borrowDays}
                      onBlur={(e) =>
                        updatePreference(
                          'borrowDays',
                          Math.max(
                            1,
                            Math.min(90, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="setting-line">
                    <div>
                      <b>Late return grace period</b>
                      <p>Days after due date before overdue handling</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      key={preferences.graceDays}
                      defaultValue={preferences.graceDays}
                      onBlur={(e) =>
                        updatePreference(
                          'graceDays',
                          Math.max(
                            0,
                            Math.min(30, Number(e.target.value) || 0),
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="setting-line">
                    <div>
                      <b>Member pending-request limit</b>
                      <p>Maximum pending requests per member</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      key={preferences.requestLimit}
                      defaultValue={preferences.requestLimit}
                      onBlur={(e) =>
                        updatePreference(
                          'requestLimit',
                          Math.max(
                            1,
                            Math.min(20, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </div>
                  <h3 className="settings-subhead">Reputation rules</h3>
                  <div className="setting-line">
                    <div>
                      <b>On-time return reward</b>
                      <p>Points awarded for returning on or before deadline</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      key={preferences.onTimePoints}
                      defaultValue={preferences.onTimePoints}
                      onBlur={(e) =>
                        updatePreference(
                          'onTimePoints',
                          Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 0),
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="setting-line">
                    <div>
                      <b>Late return penalty</b>
                      <p>Points deducted for a late return</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      key={preferences.latePenalty}
                      defaultValue={preferences.latePenalty}
                      onBlur={(e) =>
                        updatePreference(
                          'latePenalty',
                          Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 0),
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="setting-line">
                    <div>
                      <b>Non-return penalty</b>
                      <p>Points deducted when equipment is not returned</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      key={preferences.nonReturnPenalty}
                      defaultValue={preferences.nonReturnPenalty}
                      onBlur={(e) =>
                        updatePreference(
                          'nonReturnPenalty',
                          Math.max(
                            1,
                            Math.min(500, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </div>
                </section>
                <section className="panel settings-panel">
                  <h3>Role permissions</h3>
                  {[
                    [
                      'Super Admin',
                      'All permissions; only role allowed to remove Admins',
                    ],
                    [
                      'Admin',
                      'Full workspace control, reputation adjustments and settings',
                    ],
                    [
                      'Moderator',
                      'Inventory, products, categories and settings',
                    ],
                    [
                      'Secretary',
                      'Review, approve and reject requests; process returns',
                    ],
                    [
                      'Member',
                      'Browse equipment and submit borrowing requests',
                    ],
                  ].map((r) => (
                    <div className="role-line" key={r[0]}>
                      <ShieldCheck size={17} />
                      <div>
                        <b>{r[0]}</b>
                        <span>{r[1]}</span>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="panel settings-panel ledger-panel">
                  <div className="panel-head">
                    <h3>Reputation ledger</h3>
                    <span className="count-badge">{repLedger.length}</span>
                  </div>
                  {repLedger.length ? (
                    repLedger.map((e) => (
                      <div className="ledger-row" key={e.id}>
                        <b>{e.member}</b>
                        <span>{e.reason}</span>
                        <strong
                          className={e.points > 0 ? 'positive' : 'negative'}
                        >
                          {e.points > 0 ? '+' : ''}
                          {e.points}
                        </strong>
                        <small>
                          {new Date(e.at).toLocaleString()} · by {e.actor}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p className="table-footnote">
                      No reputation transactions yet. Every earned or deducted
                      point will be listed here with a reason, timestamp and
                      actor.
                    </p>
                  )}
                </section>
              </div>
            )}
          </div>
          {(page === 'Activity log' || page === 'Settings') &&
            (activities.length === historyLimit ||
              repLedger.length === historyLimit) && (
              <button
                className="button"
                onClick={() => setHistoryLimit((x) => x + 100)}
              >
                Load older records
              </button>
            )}
          <footer className="footer">
            <span>RoboHaven · Robotics Club equipment & achievement hub</span>
          </footer>
        </div>
      </main>
      {profileMember && (
        <div className="modal-backdrop" onClick={() => setProfileMember(null)}>
          <div
            className="form-modal member-profile-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setProfileMember(null)}
              aria-label="Close member profile"
            >
              <X size={19} />
            </button>
            <div className="profile-top">
              <div
                className={`member-avatar profile-avatar-large sanction-avatar ${profileMember.status === 'banned' ? 'is-kicked' : profileMember.status === 'suspended' && (!profileMember.suspendedUntil || Date.parse(profileMember.suspendedUntil) > now) ? 'is-suspended' : ''}`}
              >
                {profileMember.avatar ? (
                  <Image
                    unoptimized
                    src={profileMember.avatar}
                    alt={profileMember.name}
                    fill
                    sizes="88px"
                  />
                ) : (
                  initials(profileMember.name)
                )}
                {profileMember.status &&
                  profileMember.status !== 'active' &&
                  !(
                    profileMember.status === 'suspended' &&
                    profileMember.suspendedUntil &&
                    Date.parse(profileMember.suspendedUntil) <= now
                  ) && (
                    <span className="sanction-stamp">
                      {profileMember.status === 'banned'
                        ? 'KICKED'
                        : 'SUSPENDED'}
                    </span>
                  )}
              </div>
              <div>
                <span className="eyebrow">ROBOTICS MEMBER PROFILE</span>
                <h2>{profileMember.name}</h2>
                <p>
                  {profileMember.team} ·{' '}
                  {profileMember.grade || 'Academic level not provided'}
                </p>
                <b className="profile-rank">
                  <Medal size={15} /> {profileMember.rep} reputation points
                </b>
              </div>
            </div>
            <div className="profile-stats">
              <div>
                <b>
                  {
                    donations.filter(
                      (d) =>
                        d.memberId === profileMember.id &&
                        d.status === 'Accepted',
                    ).length
                  }
                </b>
                <span>Accepted contributions</span>
              </div>
              <div>
                <b>
                  {role === 'Member' && profileMember.id !== account.id
                    ? profileMember.achievements?.length || 0
                    : requests.filter(
                        (r) =>
                          r.memberId === profileMember.id &&
                          r.status === 'Approved',
                      ).length}
                </b>
                <span>
                  {role === 'Member' && profileMember.id !== account.id
                    ? 'Verified achievements'
                    : 'Approved loans'}
                </span>
              </div>
            </div>
            <h3>Contribution record</h3>
            {donations
              .filter(
                (d) =>
                  d.memberId === profileMember.id &&
                  (role !== 'Member' || d.status === 'Accepted'),
              )
              .map((d) => (
                <div className="ledger-row" key={d.id}>
                  <b>
                    {d.kind}: {d.item}
                  </b>
                  <span>{d.detail}</span>
                  {d.image && (
                    <div className="contribution-image-preview">
                      {d.image.split('|').map((src, i) => (
                        <button
                          type="button"
                          className="contribution-image-button"
                          key={src + i}
                          onClick={() =>
                            setImagePreview({ src, title: d.item })
                          }
                          aria-label={`View ${d.item} photograph ${i + 1}`}
                        >
                          <Image
                            unoptimized
                            src={src}
                            alt={`${d.item} photograph ${i + 1}`}
                            width={92}
                            height={70}
                          />
                          <span>
                            <Eye size={13} /> View
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <small>
                    {d.status}
                    {d.lendingUntil ? ` · Return by ${d.lendingUntil}` : ''}
                    {d.reviewedBy ? ` · reviewed by ${d.reviewedBy}` : ''}
                    {d.rejectionReason
                      ? ` · Reason: ${d.rejectionReason}`
                      : ''}{' '}
                    · {new Date(d.at).toLocaleDateString()}
                  </small>
                </div>
              ))}
            <h3>Builds & achievements</h3>
            {(
              profileMember.achievements || [
                'Verified projects and tournament results will appear here.',
              ]
            ).map((a) => (
              <div className="achievement-line" key={a}>
                <Trophy size={15} />
                {a}
              </div>
            ))}
            <div className="profile-status">
              <span>
                Membership status:{' '}
                <b>
                  {profileMember.status === 'banned'
                    ? 'Kicked / banned'
                    : profileMember.status === 'suspended' &&
                        (!profileMember.suspendedUntil ||
                          Date.parse(profileMember.suspendedUntil) > now)
                      ? 'Suspended'
                      : 'Active'}
                </b>
              </span>
              {(canAdmin || profileMember.id === account.id) &&
                profileMember.statusReason && (
                  <small>Reason: {profileMember.statusReason}</small>
                )}
              {canManage && (
                <button
                  className="text-link"
                  onClick={() =>
                    setTextDialog({
                      kind: 'achievement',
                      title: `Add an achievement for ${profileMember.name}`,
                      value: '',
                    })
                  }
                >
                  Add verified achievement
                </button>
              )}
              {canAdmin &&
                profileMember.status &&
                profileMember.status !== 'active' && (
                  <button
                    className="button button-quiet button-small"
                    onClick={() => withdrawSanction(profileMember.id)}
                  >
                    Withdraw{' '}
                    {profileMember.status === 'banned' ? 'kick' : 'suspension'}
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
      {selected && (
        <div
          className={`modal-backdrop ${closing ? 'is-closing' : ''}`}
          onClick={closeAll}
        >
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={closeAll}
              aria-label="Close details"
            >
              <X size={19} />
            </button>
            <div
              className="detail-image"
              onPointerMove={(e) => {
                if (e.buttons === 1)
                  setViewRotation((v) => v + e.movementX * 0.7);
              }}
              onPointerDown={(e) =>
                e.currentTarget.setPointerCapture(e.pointerId)
              }
            >
              <Image
                unoptimized
                src={
                  selected.views?.length
                    ? selected.views[orbitIndex]
                    : selected.image
                }
                alt={`${selected.name} product photo`}
                fill
                sizes="(max-width: 760px) 100vw, 55vw"
              />
              <span className="detail-360-label">
                <Rotate3D size={15} />{' '}
                {selected.views?.length
                  ? `Photo ${orbitIndex + 1} of ${selected.views.length}`
                  : 'Product photograph'}
              </span>
            </div>
            <div className="detail-copy">
              <div className="code-tag">
                {selected.code}
                <span>{selected.category}</span>
              </div>
              <h2>{selected.name}</h2>
              <p>
                Club-owned equipment available for approved robotics projects,
                workshops and competition preparation.
              </p>
              <div className="detail-stats">
                <div>
                  <b>{selected.available}</b>
                  <span>Available</span>
                </div>
                <div>
                  <b>{selected.total}</b>
                  <span>Total units</span>
                </div>
                <div>
                  <b>{selected.cap}</b>
                  <span>Per request</span>
                </div>
              </div>
              <div className="detail-condition">
                <span>Condition</span>
                <b>
                  <CheckCircle2 size={15} /> {selected.condition}
                </b>
              </div>
              <p className="product-description">
                {selected.description ||
                  'Club equipment maintained for workshops, prototypes and competition projects.'}
              </p>
              {canModerate && (
                <button
                  className="text-link"
                  onClick={() =>
                    setTextDialog({
                      kind: 'description',
                      title: `Edit ${selected.name} description`,
                      value: selected.description || '',
                    })
                  }
                >
                  Edit description <ArrowUpRight size={14} />
                </button>
              )}
              {(selected.views?.length || 0) > 1 && (
                <div
                  className="orbit-preview"
                  onPointerMove={(e) => {
                    if (e.buttons === 1)
                      setViewRotation((v) => v + e.movementX * 0.7);
                  }}
                  onPointerDown={(e) =>
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }
                >
                  <div className="orbit-image">
                    <Image
                      unoptimized
                      src={
                        selected.views?.length
                          ? selected.views[orbitIndex]
                          : selected.image
                      }
                      alt={`${selected.name} product photo`}
                      fill
                      sizes="320px"
                    />
                  </div>
                  <span>
                    <Rotate3D size={15} /> Drag to rotate{' '}
                    {selected.views?.length
                      ? `· ${selected.views.length} angles`
                      : 'single-photo preview'}
                  </span>
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() =>
                      setViewRotation(
                        (((orbitIndex + 1) % selected.views!.length) * 360) /
                          selected.views!.length +
                          0.001,
                      )
                    }
                  >
                    Next photo
                  </button>
                </div>
              )}
              {canModerate && (
                <label className="angle-editor">
                  Add or replace 360° angle photos
                  <input
                    type="file"
                    disabled={uploadsPending > 0}
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={async (e) => {
                      const files = (
                        Array.from(e.target.files || []) as File[]
                      ).slice(0, 24);
                      if (!files.length) return;
                      if (files.some((f) => f.size > 3 * 1024 * 1024)) {
                        notify('Each angle image must be smaller than 3 MB.');
                        return;
                      }
                      try {
                        const views = await Promise.all(
                          files.map(uploadEquipmentImage),
                        );
                        await mutate(
                          'save_equipment',
                          { target: selected.id, changes: { views } },
                          'Photos saved.',
                        );
                        setViewRotation(0);
                      } catch {
                        notify(
                          'Could not save the angle images. Check storage permissions.',
                        );
                      }
                    }}
                  />
                  <small>
                    Upload 8–24 photos in clockwise order for a true 360° spin.
                  </small>
                </label>
              )}
              {canModerate && (
                <div className="modal-actions">
                  <label className="condition-editor">
                    Edit condition
                    <select
                      value={selected.condition}
                      onChange={(e) => {
                        void mutate(
                          'save_equipment',
                          {
                            target: selected.id,
                            changes: { condition: e.target.value },
                          },
                          'Condition saved.',
                        );
                      }}
                    >
                      {[
                        'Excellent',
                        'Good',
                        'Fair',
                        'Repairable',
                        'Damaged',
                        'Unusable',
                      ].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button button-danger button-small"
                    onClick={() => setArchiveConfirm(true)}
                  >
                    Archive item
                  </button>
                </div>
              )}
              <button
                className="button button-primary button-full"
                onClick={() => {
                  const p = selected;
                  setSelected(null);
                  if (role === 'Member') openRequest(p);
                }}
              >
                {role === 'Member' ? 'Request this equipment' : 'Close details'}{' '}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div
          className={`modal-backdrop ${closing ? 'is-closing' : ''}`}
          onClick={closeAll}
        >
          <div className="form-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={closeAll}
              aria-label="Close dialog"
            >
              <X size={19} />
            </button>
            {modal === 'contribute' ? (
              <>
                <h2>
                  {newDonationKind === 'Donation'
                    ? 'Donate equipment'
                    : 'Lend equipment'}
                </h2>
                <p className="modal-intro">
                  Share a component with the club. A leadership member will
                  review your offer.
                </p>
                <label>
                  Contribution type
                  <select
                    value={newDonationKind}
                    onChange={(e) =>
                      setNewDonationKind(e.target.value as 'Donation' | 'Lend')
                    }
                  >
                    <option>Donation</option>
                    <option>Lend</option>
                  </select>
                </label>
                <label>
                  Item name
                  <input
                    value={newDonationItem}
                    onChange={(e) => setNewDonationItem(e.target.value)}
                    placeholder="e.g. L298N motor driver"
                  />
                </label>
                <label>
                  Details
                  <textarea
                    value={newDonationDetail}
                    onChange={(e) => setNewDonationDetail(e.target.value)}
                    rows={3}
                    placeholder="Condition, quantity, specifications, included accessories..."
                  />
                </label>
                <label>
                  Item photograph
                  <input
                    type="file"
                    disabled={uploadsPending > 0}
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        uploadEquipmentImage(file)
                          .then(setNewDonationImage)
                          .catch(() =>
                            notify('Could not read the item photograph.'),
                          );
                      }
                    }}
                  />
                  <small>
                    Photograph any item you want to donate or lend. It does not
                    need to exist in the equipment catalogue.
                  </small>
                </label>
                {newDonationImage && (
                  <div className="contribution-image-preview">
                    <Image
                      unoptimized
                      src={newDonationImage}
                      alt="Your contribution item"
                      width={120}
                      height={90}
                    />
                  </div>
                )}
                {newDonationKind === 'Lend' && (
                  <label>
                    Expected return date
                    <input
                      type="date"
                      min={new Date(now).toISOString().slice(0, 10)}
                      value={newDonationUntil}
                      onChange={(e) => setNewDonationUntil(e.target.value)}
                    />
                  </label>
                )}
                <div className="modal-actions">
                  <button className="button button-quiet" onClick={closeAll}>
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() =>
                      void mutate(
                        'submit_contribution',
                        {
                          item: newDonationItem,
                          detail: newDonationDetail,
                          kind: newDonationKind.toLowerCase(),
                          until_date:
                            newDonationKind === 'Lend'
                              ? newDonationUntil
                              : null,
                          photo: newDonationImage || null,
                        },
                        'Offer submitted.',
                        () => {
                          setModal(null);
                          setNewDonationItem('');
                          setNewDonationDetail('');
                          setNewDonationImage('');
                        },
                      )
                    }
                  >
                    {uploadsPending
                      ? 'Uploading image…'
                      : decisionBusy
                        ? 'Saving…'
                        : 'Submit offer'}{' '}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              </>
            ) : modal === 'request' ? (
              <>
                <h2>Request equipment</h2>
                <p className="modal-intro">
                  Tell the equipment team what you need and what you’re
                  building.
                </p>
                <label>
                  Member
                  <input value={displayName} readOnly />
                </label>
                <label>
                  Equipment
                  <select
                    value={requestProduct}
                    onChange={(e) => {
                      setRequestProduct(e.target.value);
                      setRequestQty('1');
                    }}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="request-quantity">
                  <label htmlFor="borrow-quantity">Quantity</label>
                  <div className="request-quantity-controls">
                    <input
                      id="borrow-quantity"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={requestQty}
                      onChange={(e) =>
                        setRequestQty(e.target.value.replace(/^0+(?=\d)/, ''))
                      }
                      aria-describedby="borrow-quantity-stock borrow-quantity-error"
                      aria-invalid={Boolean(quantityError)}
                    />
                    <select
                      aria-label="Choose request quantity"
                      title="Choose request quantity"
                      value=""
                      disabled={requestLimit < 1}
                      onChange={(e) => setRequestQty(e.target.value)}
                    >
                      <option value="" disabled hidden></option>
                      {Array.from({ length: requestLimit }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                  <small id="borrow-quantity-stock">
                    {availableUnits} of {requestedItem?.total ?? 0} units
                    available · Maximum per request: {requestLimit}
                  </small>
                  <small id="borrow-quantity-error" aria-live="polite">
                    {quantityError}
                  </small>
                </div>
                <label>
                  Project / purpose
                  <textarea
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="e.g. Autonomous rover for the inter-university robotics competition"
                    rows={3}
                  />
                </label>
                <label>
                  Project / competition deadline{' '}
                  <small>
                    Optional · helps the Secretary prioritize requests
                  </small>
                  <input
                    type="date"
                    value={projectDeadline}
                    min={new Date(now).toISOString().slice(0, 10)}
                    onChange={(e) => setProjectDeadline(e.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button className="button button-quiet" onClick={closeAll}>
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    disabled={
                      !requestQty || Boolean(quantityError) || decisionBusy
                    }
                    onClick={submitRequest}
                  >
                    Submit request <ArrowUpRight size={16} />
                  </button>
                </div>
              </>
            ) : modal === 'member' ? (
              <>
                <h2>Edit my profile</h2>
                <label>
                  Full name
                  <input
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="e.g. Rafi Ahmed"
                    autoFocus
                  />
                </label>
                <label>
                  Team
                  <input
                    value={newMemberTeam}
                    onChange={(e) => setNewMemberTeam(e.target.value)}
                    placeholder="e.g. Embedded systems"
                  />
                </label>
                <label>
                  Academic level
                  <input
                    value={newMemberGrade}
                    onChange={(e) => setNewMemberGrade(e.target.value)}
                    placeholder="e.g. 3rd year · CSE"
                  />
                </label>
                <div className="modal-actions">
                  <button className="button button-quiet" onClick={closeAll}>
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() =>
                      void mutate(
                        'edit_profile',
                        {
                          display_name: newMemberName,
                          team: newMemberTeam,
                          grade: newMemberGrade,
                        },
                        'Profile saved.',
                        () => setModal(null),
                      )
                    }
                  >
                    Save profile
                    <Plus size={16} />
                  </button>
                </div>
              </>
            ) : modal === 'add' ? (
              <>
                <h2>Add equipment</h2>
                <p className="modal-intro">
                  Create a new product record in the club catalogue.
                </p>
                <label>
                  Product name
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. L298N Motor Driver"
                  />
                </label>
                <label>
                  Category
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  >
                    {[
                      'Microcontrollers',
                      'Computing',
                      'Measurement',
                      'Sensors',
                      'Motors & Motion',
                      'Workshop',
                      'Power',
                      'Other',
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Initial quantity
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={newStock}
                    onChange={(e) => setNewStock(Number(e.target.value))}
                  />
                </label>
                <label>
                  Product photograph
                  <select
                    value={newImage}
                    onChange={(e) => setNewImage(e.target.value)}
                  >
                    <option value="/products/placeholder.svg">
                      No photograph yet
                    </option>
                    <option value="/products/arduino-uno.webp">
                      Arduino board photograph
                    </option>
                    <option value="/products/raspberry-pi.webp">
                      Single-board computer photograph
                    </option>
                    <option value="/products/digital-multimeter.webp">
                      Digital multimeter photograph
                    </option>
                    <option value="/products/ultrasonic-sensor.webp">
                      Ultrasonic sensor photograph
                    </option>
                    <option value="/products/servo-motor.webp">
                      Servo motor photograph
                    </option>
                    <option value="/products/dc-gear-motor.webp">
                      DC gear motor photograph
                    </option>
                    <option value="/products/temperature-sensor.webp">
                      Temperature sensor photograph
                    </option>
                    <option value="/products/soldering-iron.webp">
                      Soldering station photograph
                    </option>
                    <option value="/products/battery-pack.webp">
                      Battery pack photograph
                    </option>
                  </select>
                </label>
                <label>
                  Upload your own product image
                  <input
                    type="file"
                    disabled={uploadsPending > 0}
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 3 * 1024 * 1024) {
                        notify('Choose an image smaller than 3 MB.');
                        return;
                      }
                      try {
                        setNewImage(await uploadEquipmentImage(file));
                        notify('Product image uploaded.');
                      } catch {
                        notify(
                          'Image upload failed. Check your equipment storage permissions.',
                        );
                      }
                    }}
                  />
                  <small>
                    PNG, JPG or WebP · max 3 MB per source image; optimized for
                    display
                  </small>
                </label>
                <label>
                  Optional 360° angle images
                  <input
                    type="file"
                    disabled={uploadsPending > 0}
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={async (e) => {
                      const files = (
                        Array.from(e.target.files || []) as File[]
                      ).slice(0, 24);
                      if (files.some((f) => f.size > 3 * 1024 * 1024)) {
                        notify('Each angle image must be smaller than 3 MB.');
                        return;
                      }
                      try {
                        setNewProductViews(
                          await Promise.all(files.map(uploadEquipmentImage)),
                        );
                        notify(
                          `${files.length} product angles loaded. Drag the preview to inspect them.`,
                        );
                      } catch {
                        notify('One or more angle images could not be read.');
                      }
                    }}
                  />
                  <small>
                    Upload 8–24 photos in order around the item for a true
                    multi-angle spin.
                  </small>
                </label>
                <label>
                  Condition
                  <select
                    value={newCondition}
                    onChange={(e) => setNewCondition(e.target.value)}
                  >
                    {[
                      'Excellent',
                      'Good',
                      'Fair',
                      'Repairable',
                      'Damaged',
                      'Unusable',
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Description
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={3}
                    placeholder="Describe the exact item, specs, included accessories or usage notes"
                  />
                </label>
                <div className="notice-inline">
                  <Wrench size={16} /> Each product has its own description,
                  condition and image.
                </div>
                <div className="modal-actions">
                  <button className="button button-quiet" onClick={closeAll}>
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    disabled={uploadsPending > 0 || decisionBusy}
                    onClick={addProduct}
                  >
                    Add to catalogue <Plus size={16} />
                  </button>
                </div>
              </>
            ) : (
              <></>
            )}
          </div>
        </div>
      )}
      {reasonDialog && (
        <div
          className="modal-backdrop reason-backdrop"
          onClick={() => setReasonDialog(null)}
        >
          <div
            className="form-modal reason-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setReasonDialog(null)}
              aria-label="Close reason dialog"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">MEMBER MANAGEMENT</span>
            <h2>
              {reasonDialog.kind === 'kick'
                ? 'Confirm member kick'
                : reasonDialog.kind === 'suspend'
                  ? 'Set suspension'
                  : reasonDialog.kind === 'custom'
                    ? 'Custom reputation adjustment'
                    : 'Reputation adjustment'}
            </h2>
            <p className="modal-intro">
              This action will be recorded in the member history. Add a specific
              reason so the decision is transparent.
            </p>
            {(reasonDialog.kind === 'rep' ||
              reasonDialog.kind === 'custom') && (
              <label>
                Reputation points
                <input
                  type="number"
                  min="-500"
                  max="500"
                  value={
                    reasonDialog.kind === 'rep'
                      ? reasonDialog.points
                      : reasonPoints
                  }
                  disabled={reasonDialog.kind === 'rep'}
                  onChange={(e) => setReasonPoints(e.target.value)}
                  placeholder="e.g. -12"
                />
                <small>
                  Positive values reward; negative values deduct. Zero is not
                  allowed.
                </small>
              </label>
            )}
            {reasonDialog.kind === 'suspend' && (
              <label>
                Suspension duration
                <select
                  value={suspendDays}
                  onChange={(e) => setSuspendDays(e.target.value)}
                >
                  {[
                    ['3', '3 days'],
                    ['7', '7 days'],
                    ['14', '14 days'],
                    ['30', '30 days'],
                    ['90', '90 days'],
                    ['180', '180 days'],
                    ['365', '365 days'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Reason
              <textarea
                className="reason-textarea"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                rows={4}
                placeholder={
                  reasonDialog.kind === 'kick'
                    ? 'Explain the conduct or policy breach...'
                    : reasonDialog.kind === 'suspend'
                      ? 'Describe why this temporary restriction is necessary...'
                      : 'Explain the contribution, return or conduct behind this adjustment...'
                }
                autoFocus
              />
            </label>
            <div className="reason-actions">
              <button
                className="button button-quiet"
                onClick={() => setReasonDialog(null)}
              >
                Cancel
              </button>
              <button
                className={`button ${reasonDialog.kind === 'kick' || reasonDialog.kind === 'suspend' ? 'button-danger' : 'button-primary'}`}
                onClick={submitReasonAction}
              >
                {reasonDialog.kind === 'kick'
                  ? 'Confirm kick'
                  : reasonDialog.kind === 'suspend'
                    ? 'Apply suspension'
                    : 'Save adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
      {imagePreview && (
        <div
          className="modal-backdrop image-lightbox"
          onClick={() => setImagePreview(null)}
        >
          <div
            className="image-lightbox-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${imagePreview.title} photograph`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setImagePreview(null)}
              aria-label="Close image preview"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">CONTRIBUTION PHOTOGRAPH</span>
            <h2>{imagePreview.title}</h2>
            <div className="image-lightbox-stage">
              <Image
                unoptimized
                src={imagePreview.src}
                alt={`${imagePreview.title} submitted photograph`}
                fill
                sizes="min(90vw,900px)"
              />
            </div>
            <p>Submitted by the member with this donation or lending offer.</p>
          </div>
        </div>
      )}
      {review && (
        <div className="modal-backdrop" onClick={closeReview}>
          <div
            className="form-modal reason-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            aria-describedby="review-description"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={closeReview}
              disabled={decisionBusy}
              aria-label="Close review"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">
              {review.kind === 'request'
                ? 'EQUIPMENT REQUEST'
                : 'CONTRIBUTION REVIEW'}
            </span>
            <h2 id="review-title">
              {review.approved ? 'Approve' : 'Reject'} {review.kind}?
            </h2>
            <p id="review-description" className="modal-intro">
              {review.description}{' '}
              {review.approved
                ? review.kind === 'request'
                  ? 'Approving will issue the equipment to this member.'
                  : 'Approving will add one unit to inventory.'
                : 'The member will receive your reason.'}
            </p>
            {!review.approved && (
              <label>
                Reason for rejection
                <textarea
                  className="reason-textarea"
                  rows={4}
                  value={rejectReason}
                  required
                  disabled={decisionBusy}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
            )}
            <div className="reason-actions">
              <button
                className="button button-quiet"
                onClick={closeReview}
                disabled={decisionBusy}
              >
                Cancel
              </button>
              <button
                className={
                  review.approved
                    ? 'button button-primary'
                    : 'button button-danger'
                }
                onClick={submitReview}
                disabled={
                  decisionBusy || (!review.approved && !rejectReason.trim())
                }
              >
                {decisionBusy
                  ? 'Saving…'
                  : (review.approved ? 'Approve ' : 'Reject ') + review.kind}
              </button>
            </div>
          </div>
        </div>
      )}
      {textDialog && (
        <div className="modal-backdrop" onClick={() => setTextDialog(null)}>
          <div
            className="form-modal reason-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setTextDialog(null)}
              aria-label="Close dialog"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">WORKSPACE EDITOR</span>
            <h2>{textDialog.title}</h2>
            <label>
              {textDialog.kind === 'achievement'
                ? 'Achievement details'
                : 'Product description'}
              <textarea
                className="reason-textarea"
                rows={5}
                value={textDialog.value}
                onChange={(e) =>
                  setTextDialog({ ...textDialog, value: e.target.value })
                }
                placeholder={
                  textDialog.kind === 'achievement'
                    ? 'Project, competition result, award or verified milestone…'
                    : 'Describe specifications, use cases and included accessories…'
                }
                autoFocus
              />
            </label>
            <div className="reason-actions">
              <button
                className="button button-quiet"
                onClick={() => setTextDialog(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={saveTextDialog}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
      {archiveConfirm && selected && (
        <div
          className="modal-backdrop"
          onClick={() => setArchiveConfirm(false)}
        >
          <div
            className="form-modal reason-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setArchiveConfirm(false)}
              aria-label="Close confirmation"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">INVENTORY ACTION</span>
            <h2>Archive {selected.name}?</h2>
            <p className="modal-intro">
              This removes the item from the active catalogue. Historical loans
              and activity records remain intact.
            </p>
            <div className="reason-actions">
              <button
                className="button button-quiet"
                onClick={() => setArchiveConfirm(false)}
              >
                Keep item
              </button>
              <button
                className="button button-danger"
                onClick={archiveSelected}
              >
                Archive item
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${/failed|error|cannot|only |required|invalid|not enough|already|enter |choose |limit|missing/i.test(toast) ? 'toast-error' : 'toast-success'}`}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <i />
      {status}
    </span>
  );
}
function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Package size={22} />
      </div>
      <b>{title}</b>
      <p>{body}</p>
      {action && (
        <button className="button button-quiet button-small" onClick={action}>
          Clear filters
        </button>
      )}
    </div>
  );
}

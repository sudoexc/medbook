import * as React from "react"
import {
  CheckIcon,
  HeartPulseIcon,
  PhoneIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"

import { PageContainer } from "@/components/molecules/page-container"
import { SectionHeader } from "@/components/molecules/section-header"
import { FilterBar } from "@/components/molecules/filter-bar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { StatusDot } from "@/components/atoms/status-dot"
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status"
import { DateText } from "@/components/atoms/date-text"
import { PhoneText } from "@/components/atoms/phone-text"
import { CopyButton } from "@/components/atoms/copy-button"
import { IconButton } from "@/components/atoms/icon-button"
import { BadgeStatus } from "@/components/atoms/badge-status"
import { KpiTile } from "@/components/atoms/kpi-tile"
import { TagChip } from "@/components/atoms/tag-chip"
import { SegmentPill } from "@/components/atoms/segment-pill"
import { EmptyState } from "@/components/atoms/empty-state"
import { SkeletonRow } from "@/components/atoms/skeleton-row"
import { SkeletonCard } from "@/components/atoms/skeleton-card"
import { MoneyText } from "@/components/atoms/money-text"

/**
 * Dev-only components showcase. Not linked from sidebar.
 * URL: /{locale}/crm/components (lives in the `(dev)` route group).
 * Renders an "unavailable" notice when NODE_ENV === "production".
 */
export default function ComponentsShowcase() {
  if (process.env.NODE_ENV === "production") {
    return (
      <PageContainer>
        <SectionHeader title="Недоступно" subtitle="Витрина компонентов доступна только в dev." />
      </PageContainer>
    )
  }

  const now = new Date()

  return (
    <PageContainer>
      <SectionHeader
        title="Components showcase"
        subtitle="Все атомы и молекулы дизайн-системы"
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Записей сегодня"
          value="128"
          delta={{ value: "+12%", direction: "up" }}
          icon={<UserIcon />}
        />
        <KpiTile
          label="Выручка"
          value={<MoneyText amount={150000000} currency="UZS" />}
          tone="success"
          delta={{ value: "+8%", direction: "up" }}
          icon={<HeartPulseIcon />}
        />
        <KpiTile
          label="Ждут приёма"
          value="5"
          tone="warning"
          icon={<PhoneIcon />}
          delta={{ value: "—", direction: "flat" }}
        />
        <KpiTile
          label="Отмены"
          value="3"
          tone="pink"
          delta={{ value: "-1", direction: "down" }}
        />
      </div>

      <Separator />

      {/* Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Кнопки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <IconButton aria-label="Delete" variant="ghost">
            <Trash2Icon />
          </IconButton>
          <CopyButton value="+998 (90) 123-45-67" label="Copy phone" />
        </CardContent>
      </Card>

      {/* Badges + status */}
      <Card>
        <CardHeader>
          <CardTitle>Badges, tags, segments, статусы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">
            <CheckIcon /> Success
          </Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="violet">Violet</Badge>
          <Badge variant="pink">Pink</Badge>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <BadgeStatus status="NEW" />
          <BadgeStatus status="WAITING" />
          <BadgeStatus status="CONFIRMED" />
          <BadgeStatus status="IN_PROGRESS" />
          <BadgeStatus status="COMPLETED" />
          <BadgeStatus status="CANCELLED" />
          <BadgeStatus status="RESCHEDULED" />
          <Separator orientation="vertical" className="mx-2 h-6" />
          <SegmentPill segment="VIP" />
          <SegmentPill segment="REGULAR" />
          <SegmentPill segment="NEW" />
          <SegmentPill segment="INACTIVE" />
          <Separator orientation="vertical" className="mx-2 h-6" />
          <TagChip label="Неврология" color="info" />
          <TagChip label="УЗИ" color="success" />
          <TagChip label="Перенесён" color="yellow" onRemove={() => {}} />
        </CardContent>
      </Card>

      {/* Avatars + status dots */}
      <Card>
        <CardHeader>
          <CardTitle>Аватары и статусы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <AvatarWithStatus name="Иван Иванов" status="online" size="sm" />
          <AvatarWithStatus name="Анна Петрова" status="busy" size="md" />
          <AvatarWithStatus name="Muhammad" status="waiting" size="lg" />
          <AvatarWithStatus name="Dr. House" size="xl" />
          <Separator orientation="vertical" className="mx-2 h-10" />
          <div className="flex items-center gap-2">
            <StatusDot status="online" size="md" /> online
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status="busy" size="md" /> busy
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status="waiting" size="md" /> waiting
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status="in-progress" size="md" /> in-progress
          </div>
        </CardContent>
      </Card>

      {/* Forms */}
      <Card>
        <CardHeader>
          <CardTitle>Формы</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">ФИО</Label>
            <Input id="name" placeholder="Иванов Иван" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Заметка</Label>
            <Textarea id="notes" placeholder="Комментарий..." />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="c1" defaultChecked /> <Label htmlFor="c1">Согласие</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="s1" defaultChecked /> <Label htmlFor="s1">Уведомления</Label>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Табы</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">Инфо</TabsTrigger>
              <TabsTrigger value="visits">Визиты</TabsTrigger>
              <TabsTrigger value="payments">Платежи</TabsTrigger>
            </TabsList>
            <TabsContent value="info" className="pt-3 text-sm">
              Информация о пациенте
            </TabsContent>
            <TabsContent value="visits" className="pt-3 text-sm">
              История визитов
            </TabsContent>
            <TabsContent value="payments" className="pt-3 text-sm">
              История платежей
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Таблица</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пациент</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { id: 1, name: "Иванов Иван", status: "COMPLETED" as const, amount: 150000000 },
                { id: 2, name: "Петрова Анна", status: "WAITING" as const, amount: 25000000 },
                { id: 3, name: "Ким Сергей", status: "CANCELLED" as const, amount: 0 },
              ].map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <AvatarWithStatus name={r.name} size="sm" />
                      {r.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <PhoneText phone="+998901234567" />
                  </TableCell>
                  <TableCell>
                    <DateText date={now} style="short" />
                  </TableCell>
                  <TableCell>
                    <BadgeStatus status={r.status} />
                  </TableCell>
                  <TableCell>
                    <MoneyText amount={r.amount} currency="UZS" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Filter bar */}
      <FilterBar
        chips={[
          { id: "1", label: "Сегодня", color: "primary" },
          { id: "2", label: "Невролог", color: "info" },
          { id: "3", label: "VIP", color: "violet" },
        ]}
        onRemove={() => {}}
        onClear={() => {}}
        actions={<Button size="sm">Добавить фильтр</Button>}
      />

      {/* Progress + alerts */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Загрузка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={63} />
            <Progress value={20} />
            <Progress value={92} />
          </CardContent>
        </Card>
        <div className="space-y-2">
          <Alert variant="info">
            <HeartPulseIcon />
            <AlertTitle>Info</AlertTitle>
            <AlertDescription>Всё по плану.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>Требуется внимание.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Что-то пошло не так.</AlertDescription>
          </Alert>
        </div>
      </div>

      {/* Skeletons + empty */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Skeletons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <SkeletonRow cols={4} />
            <SkeletonRow cols={4} />
            <SkeletonCard withAvatar />
          </CardContent>
        </Card>
        <EmptyState
          icon={<UserIcon />}
          title="Нет данных"
          description="Ещё не создано ни одной записи."
          action={<Button size="sm">Создать</Button>}
        />
      </div>
    </PageContainer>
  )
}

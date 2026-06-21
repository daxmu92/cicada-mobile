import { useCallback, useMemo, useState } from 'react';
import { FlatList, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  getIncomeOutlayTotalsForMonth,
  listTransactionsInMonth,
} from '../../src/db/tran-repo';
import {
  currentYearMonth,
  prevYearMonth,
  nextYearMonth,
  formatMonthYear,
  formatLongDate,
} from '../../src/utils/date';
import { useFormat, useLocale, useSemanticColors } from '../../src/hooks/SettingsContext';
import type { Transaction } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';
import { CategoryBars } from '../../src/components/charts/CategoryBars';

type Tab = 'list' | 'breakdown';

export default function TransactionsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const locale = useLocale();
  const { gain, loss } = useSemanticColors();
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState({ income: 0, outlay: 0 });
  const [tab, setTab] = useState<Tab>('list');

  const loadData = useCallback(async () => {
    const [txs, t] = await Promise.all([
      listTransactionsInMonth(selectedMonth),
      getIncomeOutlayTotalsForMonth(selectedMonth),
    ]);
    setTransactions(txs);
    setTotals(t);
  }, [selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const breakdowns = useMemo(() => {
    const groupBy = (type: 'INCOME' | 'OUTLAY') => {
      const agg = new Map<string, number>();
      transactions
        .filter((tx) => tx.type === type)
        .forEach((tx) => {
          const tags = tx.cat.split(',').map((t) => t.trim()).filter(Boolean);
          if (tags.length === 0) {
            agg.set('Untagged', (agg.get('Untagged') ?? 0) + tx.value);
          } else {
            tags.forEach((tag) =>
              agg.set(tag, (agg.get(tag) ?? 0) + tx.value / tags.length)
            );
          }
        });
      return Array.from(agg.entries()).map(([label, value]) => ({ label, value }));
    };
    return { income: groupBy('INCOME'), outlay: groupBy('OUTLAY') };
  }, [transactions]);

  const sections = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const list = byDate.get(tx.date);
      if (list) {
        list.push(tx);
      } else {
        byDate.set(tx.date, [tx]);
      }
    }
    const formatDate = (isoDate: string) => formatLongDate(isoDate, locale);
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([date, items]) => ({
        title: formatDate(date),
        data: [...items].sort((a, b) => b.id - a.id),
      }));
  }, [transactions, locale]);

  const net = totals.income - totals.outlay;

  return (
    <View style={shared.screen}>
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <View style={[shared.card, styles.selectorCard]}>
          <TouchableOpacity
            onPress={() => setSelectedMonth(prevYearMonth(selectedMonth))}
            style={styles.arrowBtn}>
            <Text style={styles.arrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>
            {formatMonthYear(selectedMonth, locale)}
          </Text>
          <TouchableOpacity
            onPress={() => setSelectedMonth(nextYearMonth(selectedMonth))}
            style={styles.arrowBtn}>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.totalsRow}>
          <View style={[shared.card, styles.totalCard]}>
            <Text style={shared.sectionTitle}>{t('transactions.income')}</Text>
            <Text style={[styles.totalValue, { color: gain }]}>
              {fmt(totals.income)}
            </Text>
          </View>
          <View style={[shared.card, styles.totalCard]}>
            <Text style={shared.sectionTitle}>{t('transactions.outlay')}</Text>
            <Text style={[styles.totalValue, { color: loss }]}>
              {fmt(totals.outlay)}
            </Text>
          </View>
          <View style={[shared.card, styles.totalCard]}>
            <Text style={shared.sectionTitle}>{t('transactions.net')}</Text>
            <Text
              style={[
                styles.totalValue,
                { color: net >= 0 ? gain : loss },
              ]}>
              {fmt(net)}
            </Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          {(['list', 'breakdown'] as const).map((tabKey) => (
            <TouchableOpacity
              key={tabKey}
              onPress={() => setTab(tabKey)}
              style={[styles.tab, tab === tabKey && styles.tabActive]}>
              <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]}>
                {tabKey === 'list' ? t('transactions.list') : t('transactions.breakdown')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'list' ? (
        <SectionList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          sections={sections}
          keyExtractor={(t) => String(t.id)}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={shared.muted}>{t('transactions.noTransactions')}</Text>
            </View>
          }
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.sectionHeader}>{title}</Text>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[shared.card, styles.txRow]}
              onPress={() => router.push(`/modals/add-transaction?id=${item.id}`)}>
              <View style={{ flex: 1 }}>
                <View style={styles.txHeader}>
                  <Text style={styles.txType}>
                    {item.type === 'INCOME' ? '+' : '−'}
                  </Text>
                  <Text style={styles.txDate}>{item.date}</Text>
                </View>
                {item.cat ? <Text style={styles.txCat}>{item.cat}</Text> : null}
                {item.note ? <Text style={styles.txNote}>{item.note}</Text> : null}
              </View>
              <Text
                style={[
                  styles.txValue,
                  { color: item.type === 'INCOME' ? gain : loss },
                ]}>
                {fmt(item.value)}
              </Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          data={[{ key: 'breakdown' }]}
          keyExtractor={(i) => i.key}
          renderItem={() => (
            <View>
              <View style={shared.card}>
                <Text style={[shared.sectionTitle, { marginBottom: spacing.sm }]}>
                  {t('transactions.incomeByCategory')}
                </Text>
                <CategoryBars
                  items={breakdowns.income}
                  color={gain}
                  emptyText={t('transactions.noIncome')}
                />
              </View>
              <View style={shared.card}>
                <Text style={[shared.sectionTitle, { marginBottom: spacing.sm }]}>
                  {t('transactions.outlayByCategory')}
                </Text>
                <CategoryBars
                  items={breakdowns.outlay}
                  color={loss}
                  emptyText={t('transactions.noOutlay')}
                />
              </View>
            </View>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push(`/modals/add-transaction?date=${selectedMonth}-01`)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  selectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  arrowBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  arrow: {
    fontSize: 24,
    color: colors.primary,
    fontWeight: '600',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  totalsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  totalCard: {
    flex: 1,
    padding: spacing.md,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  tabTextActive: {
    color: 'white',
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  txType: {
    fontSize: 18,
    fontWeight: '700',
  },
  txDate: {
    fontSize: 14,
    color: colors.muted,
  },
  txCat: {
    fontSize: 13,
    color: colors.primary,
    marginTop: 2,
  },
  txNote: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  txValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  fabText: {
    color: 'white',
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
});

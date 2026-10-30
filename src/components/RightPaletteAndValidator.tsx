import React from 'react';
import { GostIssue, GostNodeType } from '../types/flow';

interface RightPaletteAndValidatorProps {
  activeTab: 'palette' | 'validator';
  onChangeTab: (tab: 'palette' | 'validator') => void;
  onAddManualNode: (type: GostNodeType, defaultText: string, ev: React.MouseEvent) => void;
  issues: GostIssue[];
  onFocusIssue: (issue: GostIssue) => void;
  onFixIssue: (issue: GostIssue) => void;
  onFixAllIssues: () => void;
  totalNodesCount: number;
}

const GOST_CHECKLIST_CLAUSES = [
  { clause: 'п. 3.4.2', title: 'Терминаторы начала и конца' },
  { clause: 'п. 3.2.2.4', title: 'Выходы и подписи решений' },
  { clause: 'п. 3.2.2.6', title: 'Парность границ цикла' },
  { clause: 'п. 3.4.3', title: 'Связи комментариев' },
  { clause: 'multiple_inputs_', title: 'Один прямой вход (правило проекта)' },
  { clause: 'decision_outputs_', title: 'До трёх выходов решения (проект)' },
  { clause: 'invalid_process_port_', title: 'Вход возвратов и ветвей (проект)' },
  { clause: 'edge_', title: 'Пересечения и наложения линий (проект)' },
  { clause: 'missing_predefined_', title: 'Символ вызова функции (проект)' },
  { clause: 'multiple_ends_', title: 'Один конец функции (проект)' },
];

export const RightPaletteAndValidator: React.FC<RightPaletteAndValidatorProps> = ({
  activeTab,
  onChangeTab,
  onAddManualNode,
  issues,
  onFocusIssue,
  onFixIssue,
  onFixAllIssues,
  totalNodesCount,
}) => {
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const fixableCount = issues.filter((i) => Boolean(i.fixType)).length;

  return (
    <aside className="right-panel">
      {/* Segmented Mode Header */}
      <div className="panel-header">
        <div className="inspector-tabs">
          <button
            onClick={() => onChangeTab('palette')}
            aria-pressed={activeTab === 'palette'}
            className={`flex-1 py-1 px-2 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'palette'
                ? 'inspector-tab is-active'
                : 'inspector-tab'
            }`}
          >
            Символы
          </button>
          <button
            onClick={() => onChangeTab('validator')}
            aria-pressed={activeTab === 'validator'}
            className={`flex-1 py-1 px-2 rounded text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
              activeTab === 'validator'
                ? 'inspector-tab is-active'
                : 'inspector-tab'
            }`}
          >
            <span>Проверка</span>
            {issues.length === 0 && totalNodesCount > 0 ? (
              <span className="font-mono text-[10px] text-emerald-400">OK</span>
            ) : issues.length > 0 ? (
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  errorCount > 0 ? 'text-rose-400' : 'text-amber-300'
                }`}
              >
                ({issues.length})
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {activeTab === 'palette' ? (
        <div className="sections-container">
          {/* БЛОК 1: Основные блоки C++ */}
          <div className="gost-section-block sec-2rows">
            <div className="gost-section-header">
              <span>Основные блоки для C++</span>
              <span className="sec-tag">базовые · ЕСПД</span>
            </div>
            <div className="section-grid-3">
              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('terminator', 'return 0;', e)}
              >
                <svg viewBox="0 0 60 22">
                  <rect
                    x="4"
                    y="2"
                    width="52"
                    height="18"
                    rx="9"
                    ry="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Терминатор</span>
                <span className="shape-card-sub">п. 3.4.2</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('predefined', 'int main()', e)}
              >
                <svg viewBox="0 0 60 22">
                  <rect
                    x="4"
                    y="2"
                    width="52"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <line x1="11" y1="2" x2="11" y2="20" stroke="currentColor" strokeWidth="1.7" />
                  <line x1="49" y1="2" x2="49" y2="20" stroke="currentColor" strokeWidth="1.7" />
                </svg>
                <span className="shape-card-title">Подпрограмма</span>
                <span className="shape-card-sub">п. 3.2.2.1</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('process', 'sum = sum + i;', e)}
              >
                <svg viewBox="0 0 60 22">
                  <rect
                    x="4"
                    y="2"
                    width="52"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Процесс</span>
                <span className="shape-card-sub">Расчёт / присваив.</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('io', 'cout << sum << endl;', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="12,2 56,2 48,20 4,20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Данные</span>
                <span className="shape-card-sub">Ввод cin / cout</span>
              </button>

              <button className="shape-card" onClick={(e) => onAddManualNode('brace', '{', e)}>
                <svg viewBox="0 0 60 22">
                  <text
                    x="30"
                    y="11"
                    fill="currentColor"
                    fontSize="19"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    &#123;
                  </text>
                </svg>
                <span className="shape-card-title">Скобка &#123;</span>
                <span className="shape-card-sub">Начало блока</span>
              </button>

              <button className="shape-card" onClick={(e) => onAddManualNode('brace', '}', e)}>
                <svg viewBox="0 0 60 22">
                  <text
                    x="30"
                    y="11"
                    fill="currentColor"
                    fontSize="19"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    &#125;
                  </text>
                </svg>
                <span className="shape-card-title">Скобка &#125;</span>
                <span className="shape-card-sub">Конец блока</span>
              </button>
            </div>
          </div>

          {/* БЛОК 2: Ветвления, циклы и сноски */}
          <div className="gost-section-block sec-2rows">
            <div className="gost-section-header">
              <span>Ветвления, циклы и сноски</span>
              <span className="sec-tag">логика · п. 3.2</span>
            </div>
            <div className="section-grid-3">
              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('decision', 'if (x > 0)', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="30,2 56,11 30,20 4,11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Решение</span>
                <span className="shape-card-sub">п. 3.2.2.4</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('prep', 'for (int i = 0; i < n; i++)', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="12,2 48,2 56,11 48,20 12,20 4,11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Подготовка</span>
                <span className="shape-card-sub">Цикл for</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) =>
                  onAddManualNode('comment', '#include <iostream>\nusing namespace std;', e)
                }
              >
                <svg viewBox="0 0 60 22">
                  <line
                    x1="4"
                    y1="11"
                    x2="24"
                    y2="11"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeDasharray="3,3"
                  />
                  <path
                    d="M 36 2 L 24 2 L 24 20 L 36 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Комментарий</span>
                <span className="shape-card-sub">Пунктир + скобка [</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('loop_start', 'Цикл 1\ni = 1..n', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="11,2 49,2 56,8 56,20 4,20 4,8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Начало цикла</span>
                <span className="shape-card-sub">п. 3.2.2.6</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('loop_end', 'Цикл 1', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="4,2 56,2 56,14 49,20 11,20 4,14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Конец цикла</span>
                <span className="shape-card-sub">п. 3.2.2.6</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('connector', '1', e)}
              >
                <svg viewBox="0 0 60 22">
                  <circle
                    cx="30"
                    cy="11"
                    r="8.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Соединитель</span>
                <span className="shape-card-sub">п. 3.4.1 (Узел)</span>
              </button>
            </div>
          </div>

          {/* БЛОК 3: Специальные процессы ГОСТ */}
          <div className="gost-section-block sec-1row">
            <div className="gost-section-header">
              <span>Специальные процессы ГОСТ</span>
              <span className="sec-tag">п. 3.2 / 3.4</span>
            </div>
            <div className="section-grid-4">
              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('manual_op', 'Ручная опер.', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="4,2 56,2 46,20 14,20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Ручная опер.</span>
                <span className="shape-card-sub">п. 3.2.2.2</span>
              </button>

              <button className="shape-card" onClick={(e) => onAddManualNode('parallel', '', e)}>
                <svg viewBox="0 0 60 22">
                  <line x1="4" y1="7" x2="56" y2="7" stroke="currentColor" strokeWidth="1.8" />
                  <line x1="4" y1="15" x2="56" y2="15" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                <span className="shape-card-title">Паралл. действ.</span>
                <span className="shape-card-sub">п. 3.2.2.5</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('striped_process', 'XB1\nМодуль', e)}
              >
                <svg viewBox="0 0 60 22">
                  <rect
                    x="4"
                    y="2"
                    width="52"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <line x1="4" y1="7" x2="56" y2="7" stroke="currentColor" strokeWidth="1.7" />
                </svg>
                <span className="shape-card-title">С полосой</span>
                <span className="shape-card-sub">п. 4.1.8</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('omission', '...', e)}
              >
                <svg viewBox="0 0 60 22">
                  <text
                    x="30"
                    y="11"
                    fill="currentColor"
                    fontSize="17"
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    ...
                  </text>
                </svg>
                <span className="shape-card-title">Пропуск (...)</span>
                <span className="shape-card-sub">п. 3.4.4</span>
              </button>
            </div>
          </div>

          {/* БЛОК 4: Носители данных и ЗУ ГОСТ */}
          <div className="gost-section-block sec-3rows">
            <div className="gost-section-header">
              <span>Носители данных и устройства</span>
              <span className="sec-tag">п. 3.1 ГОСТ</span>
            </div>
            <div className="section-grid-3">
              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('stored_data', 'Массив A', e)}
              >
                <svg viewBox="0 0 60 22">
                  <path
                    d="M 12 2 L 54 2 Q 46 11 54 20 L 12 20 Q 4 11 12 2 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Запом. данные</span>
                <span className="shape-card-sub">п. 3.1.1.2</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('ram', 'ОЗУ (RAM)', e)}
              >
                <svg viewBox="0 0 60 22">
                  <rect
                    x="4"
                    y="2"
                    width="52"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <line x1="11" y1="2" x2="11" y2="20" stroke="currentColor" strokeWidth="1.7" />
                  <line x1="4" y1="7" x2="56" y2="7" stroke="currentColor" strokeWidth="1.7" />
                </svg>
                <span className="shape-card-title">Оперативн. ЗУ</span>
                <span className="shape-card-sub">п. 3.1.2.1 (ОЗУ)</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('seq_storage', 'Лента', e)}
              >
                <svg viewBox="0 0 60 22">
                  <circle
                    cx="30"
                    cy="11"
                    r="8.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <line
                    x1="30"
                    y1="19.5"
                    x2="45"
                    y2="19.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Послед. ЗУ</span>
                <span className="shape-card-sub">п. 3.1.2.2</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('direct_storage', 'Диск / БД', e)}
              >
                <svg viewBox="0 0 60 22">
                  <path
                    d="M 10 2 L 48 2 A 6 9 0 0 1 48 20 L 10 20 A 6 9 0 0 1 10 2 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <ellipse
                    cx="48"
                    cy="11"
                    rx="5"
                    ry="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Прямое ЗУ</span>
                <span className="shape-card-sub">п. 3.1.2.3 (Диск)</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('document', 'Отчёт', e)}
              >
                <svg viewBox="0 0 60 22">
                  <path
                    d="M 4 2 L 56 2 L 56 17 Q 43 23 30 17 Q 17 11 4 18 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Документ</span>
                <span className="shape-card-sub">п. 3.1.2.4</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('manual_input', 'Клавиатура', e)}
              >
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="4,7 56,2 56,20 4,20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Ручной ввод</span>
                <span className="shape-card-sub">п. 3.1.2.5</span>
              </button>

              <button className="shape-card" onClick={(e) => onAddManualNode('card', 'Карта', e)}>
                <svg viewBox="0 0 60 22">
                  <polygon
                    points="14,2 56,2 56,20 4,20 4,8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Карта</span>
                <span className="shape-card-sub">п. 3.1.2.6</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('paper_tape', 'Лента', e)}
              >
                <svg viewBox="0 0 60 22">
                  <path
                    d="M 4 5 Q 17 0 30 5 Q 43 10 56 4 L 56 18 Q 43 23 30 18 Q 17 12 4 19 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Бумажн. лента</span>
                <span className="shape-card-sub">п. 3.1.2.7</span>
              </button>

              <button
                className="shape-card"
                onClick={(e) => onAddManualNode('display', 'Экран', e)}
              >
                <svg viewBox="0 0 60 22">
                  <path
                    d="M 14 2 L 46 2 A 10 9 0 0 1 46 20 L 14 20 Q 6 15.5 4 11 Q 6 6.5 14 2 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                <span className="shape-card-title">Дисплей</span>
                <span className="shape-card-sub">п. 3.1.2.8</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ВКЛАДКА НОРМОКОНТРОЛЯ ГОСТ 19.701-90 */
        <div className="validator-container">
          {/* Сводка статуса проверки */}
          <div className="validator-summary-box">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Проверка символов и правил проекта
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                Узлов: {totalNodesCount}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <div className="p-2 rounded bg-[#14171f] border border-[#2c3444]">
                <div className="font-mono text-base font-bold text-rose-400 tabular-nums">
                  {errorCount}
                </div>
                <div className="text-[10px] text-slate-400">Ошибок</div>
              </div>
              <div className="p-2 rounded bg-[#14171f] border border-[#2c3444]">
                <div className="font-mono text-base font-bold text-amber-300 tabular-nums">
                  {warnCount}
                </div>
                <div className="text-[10px] text-slate-400">Замечаний</div>
              </div>
              <div className="p-2 rounded bg-[#14171f] border border-[#2c3444]">
                <div className="font-mono text-base font-bold text-emerald-400 tabular-nums">
                  {totalNodesCount > 0 ? GOST_CHECKLIST_CLAUSES.filter(c => !issues.some(i => i.gostClause.includes(c.clause) || i.id.startsWith(c.clause))).length : 0}/
                  {GOST_CHECKLIST_CLAUSES.length}
                </div>
                <div className="text-[10px] text-slate-400">Проверок без замечаний</div>
              </div>
            </div>

            {fixableCount > 0 && (
              <button
                onClick={onFixAllIssues}
                className="btn btn-primary w-full justify-center mt-2.5 py-1.5"
              >
                ✨ Автоисправление всех замечаний ({fixableCount})
              </button>
            )}
          </div>

          {/* Список обнаруженных замечаний или подтверждение соответствия */}
          <div className="validator-issues-list">
            {totalNodesCount === 0 ? (
              <div className="p-4 rounded bg-[#1b202b] border border-[#2c3444] text-xs text-slate-400 text-center">
                Чертёж пуст. Добавьте символы из палитры или постройте схему из кода C++, чтобы
                выполнить проверку по ГОСТ 19.701-90.
              </div>
            ) : issues.length === 0 ? (
              <div className="p-3.5 rounded bg-emerald-950/30 border border-emerald-700/50 text-emerald-200 text-xs space-y-1.5">
                <div className="font-bold text-emerald-300 flex items-center justify-between">
                  <span>✓ Реализованные проверки пройдены</span>
                  <span className="font-mono text-[10px]">ПРОВЕРЕНО</span>
                </div>
                <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                  Автоматические проверки не выявили замечаний. Они охватывают реализованные правила и не подтверждают полное соответствие ГОСТ 19.701-90.
                </p>
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-2.5 rounded border text-xs space-y-1.5 transition-colors ${
                    issue.severity === 'error'
                      ? 'bg-rose-950/25 border-rose-800/60 text-slate-100'
                      : 'bg-amber-950/25 border-amber-800/60 text-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-400 font-mono">
                    <span
                      className={
                        issue.severity === 'error'
                          ? 'text-rose-400 font-semibold'
                          : 'text-amber-300 font-semibold'
                      }
                    >
                      {issue.severity === 'error' ? 'ОШИБКА' : 'ПРЕДУПРЕЖДЕНИЕ'} · {issue.gostClause}
                    </span>
                  </div>
                  <div className="font-semibold text-xs text-white">{issue.title}</div>
                  <p className="text-[11px] text-slate-300 leading-snug">{issue.description}</p>
                  <div className="flex items-center gap-2 pt-1">
                    {(issue.nodeId || issue.edgeId) && (
                      <button
                        onClick={() => onFocusIssue(issue)}
                        className="btn text-[11px] py-1 px-2"
                      >
                        🎯 Показать на чертеже
                      </button>
                    )}
                    {issue.fixType && (
                      <button
                        onClick={() => onFixIssue(issue)}
                        className="btn btn-primary text-[11px] py-1 px-2"
                      >
                        🔧 Исправить
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Справочник проверяемых пунктов ГОСТ 19.701-90 */}
            <div className="mt-3 pt-3 border-t border-[#2c3444] space-y-1.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                Реализованные проверки: ГОСТ и правила проекта
              </div>
              {GOST_CHECKLIST_CLAUSES.map((c) => {
                const violated = issues.some((iss) => iss.gostClause.includes(c.clause) || iss.id.startsWith(c.clause));
                return (
                  <div
                    key={c.clause}
                    className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-[#161a23] border border-[#262d3d]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`font-mono text-[10px] shrink-0 ${
                          violated ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {violated ? '!' : totalNodesCount > 0 ? '✓' : '—'} {c.clause.startsWith('п.') ? c.clause : 'Проект'}
                      </span>
                      <span className="text-slate-300 truncate">{c.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

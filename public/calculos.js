export const PASSE = 17100;
export const FAIXA = 61000;

export function numero(valor, nome, casas = 6) {
  const entrada = String(valor ?? '').trim();
  if (!/^\d+(?:[,.]\d+)?$/.test(entrada) || (entrada.split(/[,.]/)[1]?.length ?? 0) > casas) {
    throw new Error(`Informe ${nome} com até ${casas} casas decimais.`);
  }
  const resultado = Number(entrada.replace(',', '.'));
  if (resultado > 1e8) throw new Error(`Valor muito alto para ${nome}.`);
  return resultado;
}

export const centavos = valor => Math.round((valor + Number.EPSILON) * 100);

export function fechamento(dados, passe = PASSE, faixa = FAIXA) {
  const faturamento = centavos(numero(dados.faturamento, 'o faturamento', 2));
  const km = numero(dados.km, 'os quilômetros');
  const consumo = numero(dados.consumo, 'o consumo');
  const preco = numero(dados.preco, 'o preço da gasolina');
  const despesas = centavos(numero(dados.despesas || 0, 'as despesas', 2));
  const unidade = dados.unidade;
  if (consumo <= 0) throw new Error('O consumo precisa ser maior que zero.');
  if (!['km/L', 'L/km'].includes(unidade)) throw new Error('Selecione a unidade de consumo.');
  const litros = unidade === 'km/L' ? km / consumo : km * consumo;
  // Calcula o custo como fração inteira para arredondar meio centavo para cima.
  const escala = 1_000_000n;
  const inteiro = valor => BigInt(Math.round(valor * Number(escala)));
  const numerador = inteiro(km) * inteiro(preco) * 100n
    * (unidade === 'km/L' ? 1n : inteiro(consumo));
  const denominador = unidade === 'km/L' ? inteiro(consumo) * escala : escala ** 3n;
  const gasolina = Number((numerador + denominador / 2n) / denominador);
  if (!Number.isSafeInteger(gasolina)) throw new Error('O gasto calculado ficou muito alto.');
  const reserva = Math.round(faturamento * passe / faixa);
  return { faturamento, km, consumo, preco, despesas, unidade, litros, gasolina, reserva,
    liquido: faturamento - gasolina - reserva - despesas, passe, faixa };
}

export function hojeSP() {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return partes.format(new Date());
}

function somarDias(data, dias) {
  const instante = new Date(data + 'T00:00:00Z');
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

export function metas(dias, config, hoje) {
  const diaSemana = data => new Date(data + 'T00:00:00Z').getUTCDay();
  const segunda = somarDias(hoje, -((diaSemana(hoje) + 6) % 7));
  const inicioMes = hoje.slice(0, 7) + '-01';
  const proximoMes = new Date(inicioMes + 'T00:00:00Z');
  proximoMes.setUTCMonth(proximoMes.getUTCMonth() + 1);
  const registrados = new Set(dias.map(dia => dia.data));

  function periodo(inicio, fim, meta) {
    const liquido = dias.filter(d => d.data >= inicio && d.data <= hoje && d.data < fim)
      .reduce((total, d) => total + d.liquido, 0);
    const falta = Math.max(0, meta - liquido);
    let restantes = 0;
    for (let data = hoje; data < fim; data = somarDias(data, 1)) {
      if (config.dias.includes(diaSemana(data)) && !registrados.has(data)) restantes++;
    }
    return { liquido, falta, restantes, porDia: restantes ? Math.ceil(falta / restantes) : null };
  }

  return {
    semanal: periodo(segunda, somarDias(segunda, 7), config.semanal),
    mensal: periodo(inicioMes, proximoMes.toISOString().slice(0, 10), config.mensal)
  };
}
